-- Adiciona convênios para todas as clínicas cadastradas
-- Ignora se o plano já existir (sem duplicatas)
INSERT INTO insurance_plans (clinic_id, name)
SELECT c.id, p.name
FROM clinics c
CROSS JOIN (
  VALUES ('Amil'), ('Unimed'), ('Sulamérica')
) AS p(name)
WHERE NOT EXISTS (
  SELECT 1 FROM insurance_plans ip
  WHERE ip.clinic_id = c.id AND ip.name = p.name
);

-- Confirma o resultado
SELECT name FROM insurance_plans ORDER BY name;
