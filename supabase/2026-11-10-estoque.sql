-- ============================================================
-- ESTOQUE: LOTES, VALIDADE, HISTÓRICO E FUNÇÕES DE MOVIMENTAÇÃO
-- Acrescenta: colunas novas em inventory_items (ativo, controle de validade, quantidade
-- ideal, fornecedor), a tabela inventory_lots (lotes com validade), colunas novas em
-- inventory_movements (clinic_id, tipo, lote, despesa, observação, autor) e as funções
-- create_inventory_item, update_inventory_item, inventory_entry, inventory_exit,
-- inventory_count e inventory_discard_lot (service role). Na entrada de compra com valor,
-- a despesa (paga ou a pagar) é criada no Financeiro. Produtos com nome repetido (ignorando
-- maiúsculas e espaços) são renomeados com " (2)", " (3)"... antes do índice único.
-- Rode depois de supabase/2026-11-10-protese.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── inventory_items: colunas novas ──────────────────────────

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS active         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tracks_expiry  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ideal_quantity INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier       TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Saldos negativos antigos viram 0 para os CHECKs abaixo não falharem.
UPDATE inventory_items SET quantity = 0     WHERE quantity < 0;
UPDATE inventory_items SET min_quantity = 0 WHERE min_quantity < 0;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_quantity_check CHECK (quantity >= 0);
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_min_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_min_quantity_check CHECK (min_quantity >= 0);
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_ideal_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_ideal_quantity_check
  CHECK (ideal_quantity IS NULL OR ideal_quantity >= 0);

-- ── Nomes repetidos: o mais antigo fica, os demais ganham " (2)", " (3)"... ──

DO $$
DECLARE
  r      RECORD;
  v_base TEXT;
  v_n    INTEGER;
BEGIN
  FOR r IN
    SELECT id, clinic_id, btrim(name) AS base,
           row_number() OVER (PARTITION BY clinic_id, lower(btrim(name))
                              ORDER BY created_at, id) AS rn
    FROM inventory_items
  LOOP
    CONTINUE WHEN r.rn = 1;
    v_base := r.base;
    v_n := r.rn;
    -- pula sufixos que já estejam em uso na mesma clínica
    WHILE EXISTS (
      SELECT 1 FROM inventory_items i
      WHERE i.clinic_id = r.clinic_id
        AND i.id <> r.id
        AND lower(btrim(i.name)) = lower(v_base || ' (' || v_n || ')')
    ) LOOP
      v_n := v_n + 1;
    END LOOP;
    UPDATE inventory_items
    SET name = v_base || ' (' || v_n || ')'
    WHERE id = r.id AND clinic_id = r.clinic_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_name_uidx
  ON inventory_items (clinic_id, lower(btrim(name)));

-- ── Lotes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_lots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_code   TEXT,          -- "Saldo anterior" usa NULL
  expires_at DATE,
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),  -- saldo restante
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_lots_item_expires_idx ON inventory_lots (item_id, expires_at);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_lots;
CREATE POLICY "clinic_member" ON inventory_lots FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── inventory_movements: colunas novas ──────────────────────

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS clinic_id  UUID REFERENCES clinics(id) ON DELETE CASCADE;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS kind       TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS lot_id     UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IS NULL OR kind IN ('compra','devolucao','ajuste','uso','perda','vencido'));

UPDATE inventory_movements m
SET clinic_id = i.clinic_id
FROM inventory_items i
WHERE m.item_id = i.id AND m.clinic_id IS NULL;

ALTER TABLE inventory_movements ALTER COLUMN clinic_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_clinic_created_idx ON inventory_movements (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_item_created_idx   ON inventory_movements (item_id, created_at DESC);

DROP POLICY IF EXISTS "clinic_member" ON inventory_movements;
CREATE POLICY "clinic_member" ON inventory_movements FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Criar produto (service role) ────────────────────────────
-- p_data: name, category, unit, min_quantity, ideal_quantity, supplier, tracks_expiry,
-- initial_quantity, lot_code, expires_at (null ou ausente = vazio). Saldo inicial > 0
-- grava um movimento in/ajuste "Saldo inicial" (e um lote, se controla validade).
-- Devolve o id do produto. Erros: QUANTIDADE_INVALIDA; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_clinic_id UUID, p_user_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tracks  BOOLEAN := coalesce((p_data->>'tracks_expiry')::boolean, false);
  v_initial INTEGER := coalesce(nullif(p_data->>'initial_quantity', '')::integer, 0);
  v_min     INTEGER := coalesce(nullif(p_data->>'min_quantity', '')::integer, 0);
  v_ideal   INTEGER := nullif(p_data->>'ideal_quantity', '')::integer;
  v_id      UUID;
  v_lot_id  UUID := NULL;
BEGIN
  IF v_initial < 0 OR v_min < 0 OR (v_ideal IS NOT NULL AND v_ideal < 0)
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  INSERT INTO inventory_items (clinic_id, name, category, unit, quantity, min_quantity,
                               ideal_quantity, supplier, tracks_expiry)
  VALUES (p_clinic_id,
          btrim(p_data->>'name'),
          nullif(btrim(coalesce(p_data->>'category', '')), ''),
          nullif(btrim(coalesce(p_data->>'unit', '')), ''),
          v_initial, v_min, v_ideal,
          nullif(btrim(coalesce(p_data->>'supplier', '')), ''),
          v_tracks)
  RETURNING id INTO v_id;

  IF v_initial > 0 THEN
    IF v_tracks THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, v_id,
              nullif(btrim(coalesce(p_data->>'lot_code', '')), ''),
              nullif(p_data->>'expires_at', '')::date,
              v_initial)
      RETURNING id INTO v_lot_id;
    END IF;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, v_id, 'in', 'ajuste', v_initial, v_lot_id, 'Saldo inicial', p_user_id);
  END IF;

  RETURN v_id;
END;
$fn$;

-- ── Editar produto (service role) ───────────────────────────
-- p_data com as chaves name, category, unit, min_quantity, ideal_quantity, supplier,
-- active, tracks_expiry (substitui todos os campos editáveis; null ou ausente = vazio,
-- exceto active e tracks_expiry, que mantêm o valor atual se ausentes). O saldo não muda.
--   ligar validade com saldo > 0 e sem lotes: cria o lote "Saldo anterior" (sem código
--     nem validade) com o saldo;
--   desligar validade: apaga os lotes (o saldo total permanece em quantity).
-- Erros: PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INVALIDA; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.update_inventory_item(
  p_clinic_id UUID, p_id UUID, p_data JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old    inventory_items%ROWTYPE;
  v_tracks BOOLEAN;
  v_active BOOLEAN;
  v_min    INTEGER := coalesce(nullif(p_data->>'min_quantity', '')::integer, 0);
  v_ideal  INTEGER := nullif(p_data->>'ideal_quantity', '')::integer;
BEGIN
  SELECT * INTO v_old FROM inventory_items
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  IF v_min < 0 OR (v_ideal IS NOT NULL AND v_ideal < 0)
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  v_tracks := coalesce(nullif(p_data->>'tracks_expiry', '')::boolean, v_old.tracks_expiry);
  v_active := coalesce(nullif(p_data->>'active', '')::boolean, v_old.active);

  UPDATE inventory_items
  SET name           = btrim(p_data->>'name'),
      category       = nullif(btrim(coalesce(p_data->>'category', '')), ''),
      unit           = nullif(btrim(coalesce(p_data->>'unit', '')), ''),
      min_quantity   = v_min,
      ideal_quantity = v_ideal,
      supplier       = nullif(btrim(coalesce(p_data->>'supplier', '')), ''),
      active         = v_active,
      tracks_expiry  = v_tracks,
      updated_at     = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  IF v_tracks AND NOT v_old.tracks_expiry THEN
    IF v_old.quantity > 0 AND NOT EXISTS (
      SELECT 1 FROM inventory_lots WHERE item_id = p_id AND clinic_id = p_clinic_id
    ) THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, p_id, NULL, NULL, v_old.quantity);
    END IF;
  ELSIF NOT v_tracks AND v_old.tracks_expiry THEN
    DELETE FROM inventory_lots WHERE item_id = p_id AND clinic_id = p_clinic_id;
  END IF;
END;
$fn$;

-- ── Entrada (service role) ──────────────────────────────────
-- p_kind: compra | devolucao | ajuste. Produto com validade exige p_expires_at e reaproveita
-- o lote de mesmo código (sem diferenciar maiúsculas) e mesma validade. Só 'compra' com
-- p_total_cost > 0 cria despesa; p_payment:
--   {"status":"paid","method":"pix","date":"YYYY-MM-DD"}  ou  {"status":"pending","due_date":"YYYY-MM-DD"}
-- Devolve {"quantity": novo saldo, "expense": {"id","amount","status"} | null}.
-- Erros: TIPO_INVALIDO, QUANTIDADE_INVALIDA, PAGAMENTO_INVALIDO, PRODUTO_NAO_ENCONTRADO,
-- PRODUTO_INATIVO, LOTE_OBRIGATORIO.

CREATE OR REPLACE FUNCTION public.inventory_entry(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_quantity INTEGER, p_kind TEXT,
  p_lot_code TEXT, p_expires_at DATE, p_notes TEXT, p_total_cost NUMERIC, p_payment JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item     inventory_items%ROWTYPE;
  v_code     TEXT := nullif(btrim(coalesce(p_lot_code, '')), '');
  v_notes    TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_lot_id   UUID := NULL;
  v_qty      INTEGER;
  v_with_exp BOOLEAN := false;
  v_pay_st   TEXT;
  v_method   TEXT;
  v_date     DATE;
  v_due      DATE;
  v_unit     TEXT;
  v_desc     TEXT;
  v_exp_id   UUID := NULL;
  v_expense  JSONB := NULL;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('compra','devolucao','ajuste')
  THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  -- Valida o pagamento antes de mexer em qualquer coisa.
  IF p_kind = 'compra' AND coalesce(p_total_cost, 0) > 0 THEN
    v_with_exp := true;
    v_pay_st := p_payment->>'status';
    IF v_pay_st = 'paid' THEN
      v_method := p_payment->>'method';
      v_date := nullif(p_payment->>'date', '')::date;
      IF v_method IS NULL OR v_method NOT IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')
         OR v_date IS NULL
      THEN RAISE EXCEPTION 'PAGAMENTO_INVALIDO'; END IF;
    ELSIF v_pay_st = 'pending' THEN
      v_due := nullif(p_payment->>'due_date', '')::date;
      IF v_due IS NULL THEN RAISE EXCEPTION 'PAGAMENTO_INVALIDO'; END IF;
    ELSE
      RAISE EXCEPTION 'PAGAMENTO_INVALIDO';
    END IF;
  END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;
  IF NOT v_item.active THEN RAISE EXCEPTION 'PRODUTO_INATIVO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_expires_at IS NULL THEN RAISE EXCEPTION 'LOTE_OBRIGATORIO'; END IF;

    SELECT id INTO v_lot_id FROM inventory_lots
    WHERE item_id = p_item_id AND clinic_id = p_clinic_id
      AND lower(btrim(lot_code)) IS NOT DISTINCT FROM lower(v_code)
      AND expires_at = p_expires_at
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE;

    IF v_lot_id IS NULL THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, p_item_id, v_code, p_expires_at, p_quantity)
      RETURNING id INTO v_lot_id;
    ELSE
      UPDATE inventory_lots SET quantity = quantity + p_quantity
      WHERE id = v_lot_id AND clinic_id = p_clinic_id;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    UPDATE inventory_items
    SET quantity = quantity + p_quantity, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  END IF;

  IF v_with_exp THEN
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    v_desc := left('Compra: ' || v_item.name || ' — ' || p_quantity
                   || CASE WHEN v_unit IS NULL THEN '' ELSE ' ' || v_unit END, 200);

    IF v_pay_st = 'paid' THEN
      INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                            payment_method, professional_id, status, due_date, paid_at)
      VALUES (p_clinic_id, v_desc, p_total_cost, 'material', 'custeio',
              v_method, NULL, 'paid', v_date,
              (v_date::timestamp + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
      RETURNING id INTO v_exp_id;
    ELSE
      INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                            payment_method, professional_id, status, due_date, paid_at)
      VALUES (p_clinic_id, v_desc, p_total_cost, 'material', 'custeio',
              NULL, NULL, 'pending', v_due, NULL)
      RETURNING id INTO v_exp_id;
    END IF;

    v_expense := jsonb_build_object('id', v_exp_id, 'amount', p_total_cost, 'status', v_pay_st);
  END IF;

  INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id,
                                   expense_id, notes, created_by)
  VALUES (p_clinic_id, p_item_id, 'in', p_kind, p_quantity, v_lot_id,
          v_exp_id, v_notes, p_user_id);

  RETURN jsonb_build_object('quantity', v_qty, 'expense', v_expense);
END;
$fn$;

-- ── Saída (service role) ────────────────────────────────────
-- p_kind: uso | perda | vencido. Produto com validade: com p_lot_id sai só desse lote;
-- sem p_lot_id sai primeiro o que vence antes (FEFO: expires_at ASC NULLS LAST,
-- created_at ASC), atravessando lotes, com um movimento por lote tocado. Produto sem
-- validade: um único movimento, sem lote (p_lot_id deve ser nulo).
-- Devolve {"quantity": novo saldo, "lotes": [{"lot_id","lot_code","quantidade"}]}.
-- Erros: TIPO_INVALIDO, QUANTIDADE_INVALIDA, PRODUTO_NAO_ENCONTRADO, PRODUTO_INATIVO,
-- LOTE_INVALIDO, ESTOQUE_INSUFICIENTE (nada é alterado).

CREATE OR REPLACE FUNCTION public.inventory_exit(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_quantity INTEGER, p_kind TEXT,
  p_lot_id UUID, p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item  inventory_items%ROWTYPE;
  v_lot   inventory_lots%ROWTYPE;
  v_notes TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_lotes JSONB := '[]'::jsonb;
  v_left  INTEGER;
  v_take  INTEGER;
  v_avail INTEGER;
  v_qty   INTEGER;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('uso','perda','vencido')
  THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;
  IF NOT v_item.active THEN RAISE EXCEPTION 'PRODUTO_INATIVO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_lot_id IS NOT NULL THEN
      SELECT * INTO v_lot FROM inventory_lots
      WHERE id = p_lot_id AND item_id = p_item_id AND clinic_id = p_clinic_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
      IF p_quantity > v_lot.quantity THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

      UPDATE inventory_lots SET quantity = quantity - p_quantity
      WHERE id = v_lot.id AND clinic_id = p_clinic_id;

      INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
      VALUES (p_clinic_id, p_item_id, 'out', p_kind, p_quantity, v_lot.id, v_notes, p_user_id);

      v_lotes := jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id, 'lot_code', v_lot.lot_code, 'quantidade', p_quantity));
    ELSE
      SELECT coalesce(sum(l.quantity), 0) INTO v_avail FROM inventory_lots l
      WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id AND l.quantity > 0;
      IF p_quantity > v_avail THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

      v_left := p_quantity;
      FOR v_lot IN
        SELECT * FROM inventory_lots l
        WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id AND l.quantity > 0
        ORDER BY l.expires_at ASC NULLS LAST, l.created_at ASC, l.id ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(v_left, v_lot.quantity);

        UPDATE inventory_lots SET quantity = quantity - v_take
        WHERE id = v_lot.id AND clinic_id = p_clinic_id;

        INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
        VALUES (p_clinic_id, p_item_id, 'out', p_kind, v_take, v_lot.id, v_notes, p_user_id);

        v_lotes := v_lotes || jsonb_build_array(jsonb_build_object(
          'lot_id', v_lot.id, 'lot_code', v_lot.lot_code, 'quantidade', v_take));
        v_left := v_left - v_take;
      END LOOP;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    IF p_lot_id IS NOT NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
    IF p_quantity > v_item.quantity THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

    UPDATE inventory_items
    SET quantity = quantity - p_quantity, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, p_item_id, 'out', p_kind, p_quantity, NULL, v_notes, p_user_id);
  END IF;

  RETURN jsonb_build_object('quantity', v_qty, 'lotes', v_lotes);
END;
$fn$;

-- ── Contagem (service role) ─────────────────────────────────
-- Acerta o saldo para o valor contado (p_counted >= 0). Produto com validade exige
-- p_lot_id (contagem por lote); sem validade, p_lot_id deve ser nulo. Diferença diferente
-- de zero grava um movimento ajuste (in se sobrou, out se faltou); igual não grava nada.
-- Aceita produto inativo. Devolve {"quantity": saldo total, "diferenca": contado - anterior}.
-- Erros: QUANTIDADE_INVALIDA, PRODUTO_NAO_ENCONTRADO, LOTE_OBRIGATORIO, LOTE_INVALIDO.

CREATE OR REPLACE FUNCTION public.inventory_count(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_lot_id UUID, p_counted INTEGER, p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item  inventory_items%ROWTYPE;
  v_lot   inventory_lots%ROWTYPE;
  v_notes TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_diff  INTEGER;
  v_qty   INTEGER;
BEGIN
  IF p_counted IS NULL OR p_counted < 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_lot_id IS NULL THEN RAISE EXCEPTION 'LOTE_OBRIGATORIO'; END IF;

    SELECT * INTO v_lot FROM inventory_lots
    WHERE id = p_lot_id AND item_id = p_item_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

    v_diff := p_counted - v_lot.quantity;
    IF v_diff <> 0 THEN
      UPDATE inventory_lots SET quantity = p_counted
      WHERE id = v_lot.id AND clinic_id = p_clinic_id;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    IF p_lot_id IS NOT NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

    v_diff := p_counted - v_item.quantity;
    UPDATE inventory_items
    SET quantity = p_counted, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  END IF;

  IF v_diff <> 0 THEN
    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, p_item_id,
            CASE WHEN v_diff > 0 THEN 'in' ELSE 'out' END,
            'ajuste', abs(v_diff), p_lot_id, v_notes, p_user_id);
  END IF;

  RETURN jsonb_build_object('quantity', v_qty, 'diferenca', v_diff);
END;
$fn$;

-- ── Baixar lote vencido (service role) ──────────────────────
-- Baixa todo o saldo do lote com um movimento out/vencido (lote já zerado não grava nada).
-- Aceita produto inativo. O lote permanece com saldo 0 (histórico).
-- Devolve {"quantity": saldo total do produto, "baixado": unidades baixadas}.
-- Erros: LOTE_INVALIDO (inexistente ou de outra clínica), PRODUTO_NAO_ENCONTRADO.

CREATE OR REPLACE FUNCTION public.inventory_discard_lot(
  p_clinic_id UUID, p_user_id UUID, p_lot_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item_id UUID;
  v_lot     inventory_lots%ROWTYPE;
  v_qty     INTEGER;
BEGIN
  -- Acha o produto do lote para travá-lo primeiro (mesma ordem de trava das outras funções).
  SELECT item_id INTO v_item_id FROM inventory_lots
  WHERE id = p_lot_id AND clinic_id = p_clinic_id;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

  PERFORM 1 FROM inventory_items
  WHERE id = v_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  SELECT * INTO v_lot FROM inventory_lots
  WHERE id = p_lot_id AND item_id = v_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

  IF v_lot.quantity > 0 THEN
    UPDATE inventory_lots SET quantity = 0
    WHERE id = v_lot.id AND clinic_id = p_clinic_id;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, created_by)
    VALUES (p_clinic_id, v_item_id, 'out', 'vencido', v_lot.quantity, v_lot.id, p_user_id);
  END IF;

  UPDATE inventory_items
  SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                  WHERE l.item_id = v_item_id AND l.clinic_id = p_clinic_id),
      updated_at = now()
  WHERE id = v_item_id AND clinic_id = p_clinic_id
  RETURNING quantity INTO v_qty;

  RETURN jsonb_build_object('quantity', v_qty, 'baixado', v_lot.quantity);
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_inventory_item(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.update_inventory_item(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_item(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_entry(UUID, UUID, UUID, INTEGER, TEXT, TEXT, DATE, TEXT, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_entry(UUID, UUID, UUID, INTEGER, TEXT, TEXT, DATE, TEXT, NUMERIC, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_exit(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_exit(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_count(UUID, UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_count(UUID, UUID, UUID, UUID, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_discard_lot(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_discard_lot(UUID, UUID, UUID) TO service_role;
