-- ============================================================
-- MODELO DE ANAMNESE PADRÃO
-- Toda clínica passa a nascer com o modelo "Anamnese Geral" (11 perguntas).
-- Clínicas que já existem e ainda não têm nenhum modelo também recebem.
-- O modelo é comum: pode ser editado, apagado e outros podem ser criados.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_anamnesis_template(p_clinic UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Só cria se a clínica ainda não tem nenhum modelo.
  IF EXISTS (SELECT 1 FROM anamnesis_templates WHERE clinic_id = p_clinic) THEN
    RETURN;
  END IF;

  INSERT INTO anamnesis_templates (clinic_id, name, questions)
  SELECT p_clinic, 'Anamnese Geral', jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', gen_random_uuid()::text, 'text', q.text, 'type', q.type, 'options', q.options
           )) ORDER BY q.ord)
  FROM (VALUES
    (1,  'Está em tratamento médico atualmente?',          'yesno',   NULL::jsonb),
    (2,  'Faz uso de algum medicamento? Qual?',            'text',    NULL),
    (3,  'Tem alergia a algum medicamento ou material?',   'yesno',   NULL),
    (4,  'Tem pressão alta?',                              'yesno',   NULL),
    (5,  'Tem diabetes?',                                  'yesno',   NULL),
    (6,  'Tem problema cardíaco?',                         'yesno',   NULL),
    (7,  'Está grávida?',                                  'yesno',   NULL),
    (8,  'Fuma?',                                          'options', '["Não","Sim","Ex-fumante"]'),
    (9,  'Já teve reação à anestesia odontológica?',       'yesno',   NULL),
    (10, 'Com que frequência escova os dentes?',           'options', '["1 vez ao dia","2 vezes ao dia","3 ou mais vezes ao dia"]'),
    (11, 'Qual o motivo da consulta?',                     'text',    NULL)
  ) AS q(ord, text, type, options);
END;
$fn$;

-- Só o trigger e o SQL Editor chamam; usuários logados não.
REVOKE ALL ON FUNCTION public.seed_anamnesis_template(UUID) FROM PUBLIC, anon, authenticated;

-- Clínica nova: cria o modelo junto.
CREATE OR REPLACE FUNCTION public.on_clinic_created_seed_anamnesis()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public.seed_anamnesis_template(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.on_clinic_created_seed_anamnesis() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clinics_seed_anamnesis ON clinics;
CREATE TRIGGER clinics_seed_anamnesis
  AFTER INSERT ON clinics
  FOR EACH ROW EXECUTE FUNCTION public.on_clinic_created_seed_anamnesis();

-- Clínicas que já existem e não têm modelo.
SELECT public.seed_anamnesis_template(id) FROM clinics;
