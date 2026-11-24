-- ============================================================
-- IMPORTAÇÃO DO CODENTAL: MARCA DE ORIGEM E HISTÓRICO FINANCEIRO
-- Acrescenta: a coluna imported_from em patients, appointments, treatments e budgets,
-- as tabelas import_links (vínculo id de origem -> id aqui; só service role) e
-- legacy_payments (histórico financeiro importado; leitura pela clínica) e uma nova
-- versão do gatilho treatments_material_status: tratamento importado e concluído não
-- fica com material "pendente", nem ao ser criado nem ao ser concluído de novo.
-- Rode depois de supabase/2026-11-10-kits.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Marca de origem (importação) ────────────────────────────
-- Registros criados pela importação de outro sistema carregam o nome da origem.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS imported_from TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS imported_from TEXT;
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS imported_from TEXT;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS imported_from TEXT;

-- ── Gatilho: situação do material do tratamento ─────────────
-- Igual ao de 2026-11-10-kits.sql, exceto que tratamento importado
-- (imported_from preenchido) não vira 'pendente', no INSERT e no UPDATE.

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

    IF NEW.status = 'completed' AND NEW.imported_from IS NULL
       AND NEW.material_status IS NULL THEN
      NEW.material_status := 'pendente';
    END IF;
  ELSE
    NEW.material_status := OLD.material_status;
    NEW.material_kit_id := OLD.material_kit_id;

    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
       AND NEW.imported_from IS NULL
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

-- ── Vínculos da importação ──────────────────────────────────
-- Liga o id de origem ao id criado aqui, para a importação poder rodar de novo sem
-- duplicar. Só o service role acessa (sem policies).

CREATE TABLE IF NOT EXISTS import_links (
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  source_id  TEXT NOT NULL,
  target_id  UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clinic_id, source, entity, source_id)
);

ALTER TABLE import_links ENABLE ROW LEVEL SECURITY;

-- ── Histórico financeiro importado ──────────────────────────
-- Somente leitura para a clínica; a gravação é só do service role.

CREATE TABLE IF NOT EXISTS legacy_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id         UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  budget_id          UUID REFERENCES budgets(id) ON DELETE SET NULL,
  source_id          TEXT NOT NULL,
  description        TEXT,
  amount             NUMERIC(10,2) NOT NULL,
  due_date           DATE,
  paid_at            DATE,
  payment_method     TEXT,
  installment_number INTEGER,
  installment_count  INTEGER,
  original_status    TEXT NOT NULL CHECK (original_status IN ('paid','open')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, source_id)
);

CREATE INDEX IF NOT EXISTS legacy_payments_patient_idx ON legacy_payments (patient_id);

ALTER TABLE legacy_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON legacy_payments;
CREATE POLICY "clinic_member_select" ON legacy_payments FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
