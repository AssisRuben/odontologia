-- ============================================================
-- ISOLAMENTO POR CLÍNICA (RLS)
-- Antes: qualquer usuário logado lia e alterava dados de TODAS as
-- clínicas (policy "auth_all" USING (true)).
-- Depois: cada usuário só acessa a(s) clínica(s) em que tem um
-- profissional vinculado (professionals.user_id = auth.uid()).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
--
-- ATENÇÃO: depois deste script, usuário SEM linha em professionals
-- não vê dado nenhum (telas vazias). Antes de aplicar, rode a
-- consulta abaixo; para cada usuário listado, vincule-o a uma
-- clínica com o INSERT de exemplo.
-- ============================================================

-- Pré-verificação: usuários sem profissional vinculado.
-- SELECT u.id, u.email
--   FROM auth.users u
--  WHERE NOT EXISTS (SELECT 1 FROM professionals p WHERE p.user_id = u.id);
--
-- Vincular um usuário a uma clínica existente (troque os valores):
-- INSERT INTO professionals (clinic_id, user_id, name)
-- VALUES ('<id da clínica em clinics>', '<id do usuário acima>', 'Nome do profissional');

-- Clínicas do usuário logado. SECURITY DEFINER para não depender da
-- própria RLS de professionals (evita recursão).
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

-- Remove as policies abertas antigas
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clinics','professionals','insurance_plans','patients','appointments',
    'payments','expenses','prosthetics','inventory_items','inventory_movements',
    'anamnesis_templates','anamneses','treatments','treatment_teeth',
    'budgets','budget_items','documents','evolutions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "clinic_member" ON %I', t);
  END LOOP;
END $$;

-- Clínica: o usuário lê e edita só a sua. Criação é feita pelo
-- trigger de cadastro (handle_new_user), exclusão só pelo servidor.
DROP POLICY IF EXISTS "clinic_member_select" ON clinics;
DROP POLICY IF EXISTS "clinic_member_update" ON clinics;
CREATE POLICY "clinic_member_select" ON clinics FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_clinic_ids()));
CREATE POLICY "clinic_member_update" ON clinics FOR UPDATE TO authenticated
  USING (id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (id IN (SELECT public.user_clinic_ids()));

-- Tabelas com clinic_id
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'professionals','insurance_plans','patients','appointments',
    'payments','expenses','prosthetics','inventory_items',
    'anamnesis_templates','anamneses','treatments','budgets',
    'documents','evolutions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "clinic_member" ON %I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

-- Tabelas filhas (sem clinic_id): acesso pelo registro pai
CREATE POLICY "clinic_member" ON inventory_movements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = item_id
                 AND i.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = item_id
                 AND i.clinic_id IN (SELECT public.user_clinic_ids())));

CREATE POLICY "clinic_member" ON treatment_teeth FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM treatments tr WHERE tr.id = treatment_id
                 AND tr.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM treatments tr WHERE tr.id = treatment_id
                 AND tr.clinic_id IN (SELECT public.user_clinic_ids())));

CREATE POLICY "clinic_member" ON budget_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id
                 AND b.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id
                 AND b.clinic_id IN (SELECT public.user_clinic_ids())));

-- Storage: arquivos ficam em anneOdonto/<clinic_id>/<patient_id>/<arquivo>.
-- Cada clínica só lista, envia e apaga na própria pasta.
-- Atenção: o bucket continua PÚBLICO — quem tiver o link direto de um
-- arquivo consegue abri-lo. Tornar o bucket privado é uma melhoria à parte.
DROP POLICY IF EXISTS "anneOdonto_select" ON storage.objects;
DROP POLICY IF EXISTS "anneOdonto_insert" ON storage.objects;
DROP POLICY IF EXISTS "anneOdonto_delete" ON storage.objects;
CREATE POLICY "anneOdonto_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
