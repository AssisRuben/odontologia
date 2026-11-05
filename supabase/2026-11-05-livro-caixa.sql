-- ============================================================
-- LIVRO-CAIXA, CARNÊ-LEÃO E RECEITA SAÚDE
-- Acrescenta categoria, grupo de dedução, forma de pagamento, dentista,
-- observação e comprovante em expenses; dados do responsável financeiro
-- em patients; cria health_receipts (recibos marcados no Receita Saúde);
-- cria o bucket privado expense-receipts e torna privado o bucket
-- anneOdonto (documents.file_url passa a guardar o caminho no bucket).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- Função usada pelas policies (já existe se o isolamento por clínica foi aplicado)
CREATE OR REPLACE FUNCTION public.user_clinic_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT clinic_id FROM professionals WHERE user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.user_clinic_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_clinic_ids() TO authenticated;

-- ── expenses: colunas novas ─────────────────────────────────

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method  TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes           TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_path    TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_name    TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_size    BIGINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_type    TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Categorias antigas (texto livre) viram "outras"; o texto antigo vai para notes.
UPDATE expenses SET
  notes = CASE
    WHEN category IS NULL OR btrim(category) = '' THEN notes
    WHEN notes IS NULL OR notes = '' THEN category
    ELSE notes || ' · ' || category
  END,
  category = 'outras'
WHERE category IS NULL
   OR category NOT IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','outras');

ALTER TABLE expenses ALTER COLUMN category SET DEFAULT 'outras';
ALTER TABLE expenses ALTER COLUMN category SET NOT NULL;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','outras'));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_payment_method_check
  CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto'));

-- deduction_group: o preenchimento inicial roda só quando a coluna é criada,
-- para que rodar de novo não sobrescreva escolhas feitas na tela.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'deduction_group'
  ) THEN
    ALTER TABLE expenses ADD COLUMN deduction_group TEXT
      CHECK (deduction_group IN ('custeio','pessoal','emolumentos'));

    UPDATE expenses SET deduction_group = CASE category
      WHEN 'aluguel'     THEN 'custeio'
      WHEN 'contas'      THEN 'custeio'
      WHEN 'material'    THEN 'custeio'
      WHEN 'laboratorio' THEN 'custeio'
      WHEN 'servicos'    THEN 'custeio'
      WHEN 'manutencao'  THEN 'custeio'
      WHEN 'marketing'   THEN 'custeio'
      WHEN 'conselho'    THEN 'custeio'
      WHEN 'iptu_taxas'  THEN 'custeio'
      WHEN 'tarifas'     THEN 'custeio'
      WHEN 'salarios'    THEN 'pessoal'
      WHEN 'emolumentos' THEN 'emolumentos'
      ELSE NULL
    END;
  END IF;
END $$;

-- ── patients: responsável financeiro ────────────────────────

ALTER TABLE patients ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS payer_cpf  TEXT;

-- ── health_receipts: recibos marcados no Receita Saúde ──────

CREATE TABLE IF NOT EXISTS health_receipts (
  payment_id UUID PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE health_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_receipts_select" ON health_receipts;
CREATE POLICY "health_receipts_select" ON health_receipts FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

DROP POLICY IF EXISTS "health_receipts_insert" ON health_receipts;
CREATE POLICY "health_receipts_insert" ON health_receipts FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids())
              AND EXISTS (SELECT 1 FROM payments p
                          WHERE p.id = payment_id AND p.clinic_id = health_receipts.clinic_id));

DROP POLICY IF EXISTS "health_receipts_delete" ON health_receipts;
CREATE POLICY "health_receipts_delete" ON health_receipts FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Storage: comprovantes de despesa (privado) ──────────────
-- Arquivos ficam em expense-receipts/<clinic_id>/<expense_id>/<uuid>.<ext>

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "expense_receipts_select" ON storage.objects;
CREATE POLICY "expense_receipts_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
DROP POLICY IF EXISTS "expense_receipts_insert" ON storage.objects;
CREATE POLICY "expense_receipts_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
DROP POLICY IF EXISTS "expense_receipts_delete" ON storage.objects;
CREATE POLICY "expense_receipts_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));

-- ── Storage: documentos do paciente passam a privados ───────

UPDATE storage.buckets SET public = false WHERE id = 'anneOdonto';

-- documents.file_url passa a guardar o caminho no bucket (sem URL pública e sem ?query).
UPDATE documents
SET file_url = split_part(split_part(file_url, '/storage/v1/object/public/anneOdonto/', 2), '?', 1)
WHERE file_url LIKE '%/storage/v1/object/public/anneOdonto/%';
