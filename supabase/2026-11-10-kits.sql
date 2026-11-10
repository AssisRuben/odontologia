-- ============================================================
-- ESTOQUE (FASE 2): KITS DE MATERIAL E BAIXA POR TRATAMENTO
-- Acrescenta: as tabelas inventory_kits e inventory_kit_items, as colunas
-- material_status e material_kit_id em treatments, a coluna treatment_id em
-- inventory_movements, o gatilho treatments_material_status (tratamento concluído fica
-- com material "pendente") e as funções create_inventory_kit, update_inventory_kit,
-- treatment_material_apply, treatment_material_skip e treatment_material_return
-- (service role). A baixa reaproveita inventory_exit, sem modificá-la.
-- Tratamentos concluídos antes desta migração não ficam pendentes.
-- Rode depois de supabase/2026-11-10-estoque.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Kits ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_kits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kits_clinic_name_uidx
  ON inventory_kits (clinic_id, lower(btrim(name)));

ALTER TABLE inventory_kits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_kits;
CREATE POLICY "clinic_member" ON inventory_kits FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Itens do kit ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_kit_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kit_id    UUID NOT NULL REFERENCES inventory_kits(id) ON DELETE CASCADE,
  item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (kit_id, item_id)
);

CREATE INDEX IF NOT EXISTS inventory_kit_items_kit_idx ON inventory_kit_items (kit_id);

ALTER TABLE inventory_kit_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_kit_items;
CREATE POLICY "clinic_member" ON inventory_kit_items FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── treatments: colunas novas ───────────────────────────────

ALTER TABLE treatments ADD COLUMN IF NOT EXISTS material_status TEXT;
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS material_kit_id UUID
  REFERENCES inventory_kits(id) ON DELETE SET NULL;

ALTER TABLE treatments DROP CONSTRAINT IF EXISTS treatments_material_status_check;
ALTER TABLE treatments ADD CONSTRAINT treatments_material_status_check
  CHECK (material_status IS NULL OR material_status IN ('pendente','baixado','dispensado'));

-- ── inventory_movements: coluna nova ────────────────────────

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS treatment_id UUID
  REFERENCES treatments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_treatment_idx ON inventory_movements (treatment_id);

-- ── Gatilho: situação do material do tratamento ─────────────
-- As funções abaixo ligam app.material = 'on' (só na transação) e o gatilho aceita os
-- valores enviados. Em qualquer outra gravação (navegador, IA, aprovação de orçamento):
--   1. material_status e material_kit_id não mudam (INSERT: nulos; UPDATE: valores de OLD);
--   2. tratamento que acaba de ser concluído, com material nulo, fica 'pendente';
--   3. tratamento que deixa de estar concluído, com material 'pendente' ou 'dispensado',
--      volta a nulo ('baixado' não muda: a devolução é uma pergunta separada).

CREATE OR REPLACE FUNCTION public.treatments_material_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF coalesce(current_setting('app.material', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.material_status := NULL;
    NEW.material_kit_id := NULL;

    IF NEW.status = 'completed' AND NEW.material_status IS NULL THEN
      NEW.material_status := 'pendente';
    END IF;
  ELSE
    NEW.material_status := OLD.material_status;
    NEW.material_kit_id := OLD.material_kit_id;

    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
       AND NEW.material_status IS NULL THEN
      NEW.material_status := 'pendente';
    END IF;

    IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed'
       AND NEW.material_status IN ('pendente','dispensado') THEN
      NEW.material_status := NULL;
      NEW.material_kit_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS treatments_material_status ON treatments;
CREATE TRIGGER treatments_material_status
  BEFORE INSERT OR UPDATE ON treatments
  FOR EACH ROW EXECUTE FUNCTION public.treatments_material_status();

-- ── Criar kit (service role) ────────────────────────────────
-- p_data: {name, active, items: [{item_id, quantity}]}. active ausente = true.
-- items: 1 a 50, quantidade inteira de 1 a 9999, sem produto repetido, produtos da
-- mesma clínica (inativos são aceitos). Devolve o id do kit.
-- Erros: KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO, PRODUTO_INVALIDO;
-- nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.create_inventory_kit(
  p_clinic_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_items JSONB := p_data->'items';
  v_el    JSONB;
  v_num   NUMERIC;
  v_id    UUID;
BEGIN
  IF v_items IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(v_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    WHERE e.value->>'item_id' IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_items i
                      WHERE i.id = (e.value->>'item_id')::uuid AND i.clinic_id = p_clinic_id)
  ) THEN RAISE EXCEPTION 'PRODUTO_INVALIDO'; END IF;

  INSERT INTO inventory_kits (clinic_id, name, active)
  VALUES (p_clinic_id, btrim(p_data->>'name'), coalesce((p_data->>'active')::boolean, true))
  RETURNING id INTO v_id;

  INSERT INTO inventory_kit_items (clinic_id, kit_id, item_id, quantity)
  SELECT p_clinic_id, v_id, (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
  FROM jsonb_array_elements(v_items) AS e;

  RETURN v_id;
END;
$fn$;

-- ── Editar kit (service role) ───────────────────────────────
-- p_data: {name, active, items}. active ausente mantém o valor atual; items substitui a
-- lista inteira (mesmas regras da criação).
-- Erros: KIT_NAO_ENCONTRADO, KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO,
-- PRODUTO_INVALIDO; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.update_inventory_kit(
  p_clinic_id UUID, p_id UUID, p_data JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old   inventory_kits%ROWTYPE;
  v_items JSONB := p_data->'items';
  v_el    JSONB;
  v_num   NUMERIC;
BEGIN
  SELECT * INTO v_old FROM inventory_kits
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KIT_NAO_ENCONTRADO'; END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(v_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    WHERE e.value->>'item_id' IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_items i
                      WHERE i.id = (e.value->>'item_id')::uuid AND i.clinic_id = p_clinic_id)
  ) THEN RAISE EXCEPTION 'PRODUTO_INVALIDO'; END IF;

  UPDATE inventory_kits
  SET name       = btrim(p_data->>'name'),
      active     = coalesce((p_data->>'active')::boolean, v_old.active),
      updated_at = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  DELETE FROM inventory_kit_items WHERE kit_id = p_id AND clinic_id = p_clinic_id;

  INSERT INTO inventory_kit_items (clinic_id, kit_id, item_id, quantity)
  SELECT p_clinic_id, p_id, (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
  FROM jsonb_array_elements(v_items) AS e;
END;
$fn$;

-- ── Baixa de material do tratamento (service role) ──────────
-- p_kit_id é opcional e fica só como registro: a lista que vale é p_items
-- ([{item_id, quantity}], 1 a 50, quantidade inteira de 1 a 9999, sem repetição).
-- Cada produto sai por inventory_exit (motivo 'uso', FEFO), em ordem de item_id, e as
-- saídas criadas ganham o treatment_id. Falha de inventory_exit sobe como
-- '<CODIGO>:<item_id>' (ex.: ESTOQUE_INSUFICIENTE:<uuid>) e nada é gravado.
-- Devolve {"itens": [{"item_id","quantidade","lotes":[{"lot_id","lot_code","quantidade"}]}]}.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, TRATAMENTO_NAO_CONCLUIDO, MATERIAL_JA_RESOLVIDO,
-- KIT_NAO_ENCONTRADO, KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO, <CODIGO>:<item_id>.

CREATE OR REPLACE FUNCTION public.treatment_material_apply(
  p_clinic_id UUID, p_user_id UUID, p_treatment_id UUID, p_kit_id UUID, p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr      treatments%ROWTYPE;
  v_el      JSONB;
  v_num     NUMERIC;
  v_item_id UUID;
  v_qty     INTEGER;
  v_res     JSONB;
  v_notes   TEXT;
  v_itens   JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.status <> 'completed' THEN RAISE EXCEPTION 'TRATAMENTO_NAO_CONCLUIDO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'pendente'
  THEN RAISE EXCEPTION 'MATERIAL_JA_RESOLVIDO'; END IF;

  IF p_kit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_kits WHERE id = p_kit_id AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'KIT_NAO_ENCONTRADO'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(p_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  v_notes := left('Tratamento: ' || v_tr.procedure, 200);

  -- Ordem crescente de item_id: as travas dos produtos saem sempre na mesma ordem.
  FOR v_item_id, v_qty IN
    SELECT (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
    FROM jsonb_array_elements(p_items) AS e
    ORDER BY 1
  LOOP
    BEGIN
      v_res := public.inventory_exit(p_clinic_id, p_user_id, v_item_id, v_qty, 'uso', NULL::uuid, v_notes);
    EXCEPTION WHEN raise_exception THEN
      RAISE EXCEPTION '%:%', SQLERRM, v_item_id;
    END;

    -- Liga ao tratamento só as saídas que essa chamada criou (now() é o default de
    -- created_at e é fixo na transação; cada produto aparece uma vez só na lista).
    UPDATE inventory_movements
    SET treatment_id = p_treatment_id
    WHERE clinic_id = p_clinic_id AND item_id = v_item_id AND type = 'out'
      AND treatment_id IS NULL AND created_at = now();

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'quantidade', v_qty, 'lotes', v_res->'lotes'));
  END LOOP;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = 'baixado', material_kit_id = p_kit_id
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);

  RETURN jsonb_build_object('itens', v_itens);
END;
$fn$;

-- ── Dispensar material do tratamento (service role) ─────────
-- 'pendente' vira 'dispensado'.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, MATERIAL_JA_RESOLVIDO.

CREATE OR REPLACE FUNCTION public.treatment_material_skip(
  p_clinic_id UUID, p_treatment_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr treatments%ROWTYPE;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'pendente'
  THEN RAISE EXCEPTION 'MATERIAL_JA_RESOLVIDO'; END IF;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = 'dispensado'
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);
END;
$fn$;

-- ── Devolver material do tratamento (service role) ──────────
-- Devolve as saídas (type 'out') do tratamento criadas depois da última devolução dele
-- (in/devolucao com o mesmo treatment_id), em ordem de item_id. Produto com validade:
-- soma no lote original se ele ainda existe; senão cria um lote sem código e sem
-- validade; o saldo do produto vira a soma dos lotes. Produto sem validade: soma no
-- saldo. Cada saída gera um movimento in/devolucao ligado ao tratamento. Aceita produto
-- inativo. No fim, o material volta a 'pendente' (se concluído) ou a nulo, sem kit.
-- Devolve {"devolvidos": n}.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, MATERIAL_NAO_BAIXADO, PRODUTO_NAO_ENCONTRADO.

CREATE OR REPLACE FUNCTION public.treatment_material_return(
  p_clinic_id UUID, p_user_id UUID, p_treatment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr     treatments%ROWTYPE;
  v_since  TIMESTAMPTZ;
  v_mov    RECORD;
  v_tracks BOOLEAN;
  v_lot_id UUID;
  v_notes  TEXT;
  v_n      INTEGER := 0;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'baixado'
  THEN RAISE EXCEPTION 'MATERIAL_NAO_BAIXADO'; END IF;

  SELECT coalesce(max(m.created_at), '-infinity'::timestamptz) INTO v_since
  FROM inventory_movements m
  WHERE m.clinic_id = p_clinic_id AND m.treatment_id = p_treatment_id
    AND m.type = 'in' AND m.kind = 'devolucao';

  v_notes := left('Devolução: ' || v_tr.procedure, 200);

  FOR v_mov IN
    SELECT m.id, m.item_id, m.lot_id, m.quantity
    FROM inventory_movements m
    WHERE m.clinic_id = p_clinic_id AND m.treatment_id = p_treatment_id
      AND m.type = 'out' AND m.created_at > v_since
    ORDER BY m.item_id, m.created_at, m.id
  LOOP
    SELECT tracks_expiry INTO v_tracks FROM inventory_items
    WHERE id = v_mov.item_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

    v_lot_id := NULL;

    IF v_tracks THEN
      IF v_mov.lot_id IS NOT NULL THEN
        UPDATE inventory_lots SET quantity = quantity + v_mov.quantity
        WHERE id = v_mov.lot_id AND item_id = v_mov.item_id AND clinic_id = p_clinic_id
        RETURNING id INTO v_lot_id;
      END IF;

      IF v_lot_id IS NULL THEN
        INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
        VALUES (p_clinic_id, v_mov.item_id, NULL, NULL, v_mov.quantity)
        RETURNING id INTO v_lot_id;
      END IF;

      UPDATE inventory_items
      SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                      WHERE l.item_id = v_mov.item_id AND l.clinic_id = p_clinic_id),
          updated_at = now()
      WHERE id = v_mov.item_id AND clinic_id = p_clinic_id;
    ELSE
      UPDATE inventory_items
      SET quantity = quantity + v_mov.quantity, updated_at = now()
      WHERE id = v_mov.item_id AND clinic_id = p_clinic_id;
    END IF;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id,
                                     treatment_id, notes, created_by)
    VALUES (p_clinic_id, v_mov.item_id, 'in', 'devolucao', v_mov.quantity, v_lot_id,
            p_treatment_id, v_notes, p_user_id);

    v_n := v_n + 1;
  END LOOP;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = CASE WHEN status = 'completed' THEN 'pendente' ELSE NULL END,
      material_kit_id = NULL
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);

  RETURN jsonb_build_object('devolvidos', v_n);
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_inventory_kit(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_kit(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.update_inventory_kit(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_kit(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_apply(UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_apply(UUID, UUID, UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_skip(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_skip(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_return(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_return(UUID, UUID, UUID) TO service_role;
