# Livro-caixa, Carnê-Leão e Receita Saúde: Design

**Data:** 2026-11-05
**Status:** aprovado em conversa, aguardando revisão da especificação
**Roteiro:** item 3 da Fase 1 (parte restante). A NFS-e foi feita junto com a cobrança Asaas (`2026-11-04-cobranca-asaas-design.md`).

## 1. Objetivo

O dentista que atende como pessoa física precisa, todo mês, apurar o Carnê-Leão (receitas de pacientes menos despesas dedutíveis do livro-caixa) e emitir um recibo no Receita Saúde para cada pagamento de paciente. Hoje o app não tem tela para cadastrar despesas, não separa o que é dedutível e não ajuda com os recibos.

Este projeto entrega:
- cadastro de despesas com categoria já classificada para o Carnê-Leão e comprovante anexado;
- um livro-caixa mensal (calculado na hora a partir de pagamentos e despesas);
- a lista de recibos do Receita Saúde a emitir, com marcação de "emitido";
- um pacote mensal para o contador (resumo em PDF, planilha CSV e comprovantes, num .zip).

Público-alvo: dentista autônomo ou consultório pequeno (público A do roteiro).

**Sucesso significa:**
- No fim do mês, o dentista abre uma tela e vê quanto recebeu de pacientes, quanto gastou de forma dedutível, o resultado do mês e quais recibos faltam emitir.
- Um clique baixa tudo o que o contador precisa.
- Nenhuma clínica acessa despesas, comprovantes ou recibos de outra.

## 2. Fatos que orientam o desenho

- O Receita Saúde não tem integração aberta para outros sistemas. O recibo é emitido no app da Receita ou no Carnê-Leão Web (conta Gov.br prata ou ouro).
- Cada recibo emitido no Receita Saúde entra sozinho como receita no Carnê-Leão Web. A apuração mensal continua obrigatória.
- As despesas do livro-caixa continuam sendo lançadas à mão pelo dentista (ou contador) no Carnê-Leão Web.
- Recebimentos de pessoa jurídica (convênios) não entram no Carnê-Leão: o imposto é retido pela fonte pagadora. Também não têm recibo no Receita Saúde.
- O livro-caixa usa regime de caixa: receita no mês em que foi recebida, despesa no mês em que foi paga.

## 3. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Por quem é o livro-caixa | Um por clínica; despesas guardam o dentista (opcional) e pagamentos o herdam da consulta, para separar por dentista no futuro | Atende o caso comum (dono = único dentista que declara) sem fechar a porta para consultório dividido |
| Imposto estimado | Não calcular; mostrar só totais e o resultado do mês | O Carnê-Leão Web faz o cálculo oficial; um número diferente gera desconfiança |
| Pagador do recibo | Campos opcionais "responsável pelo pagamento" (nome, CPF) no paciente; vazio = o próprio paciente | Cobre pais pagando por filhos sem passo extra em cada recebimento |
| Dedutibilidade | Lista fixa de categorias, cada uma com grupo do Carnê-Leão; grupo pode ser alterado por despesa | O dentista não precisa conhecer a regra |
| Comprovantes | Anexo opcional por despesa, em bucket privado; links temporários | A Receita pode pedir os comprovantes por 5 anos |
| Documentos dos pacientes | Bucket `anneOdonto` passa a ser privado, com links temporários | Pendência de privacidade antiga; mesmo mecanismo dos comprovantes |
| Entrega ao contador | .zip com `resumo.pdf`, `lancamentos.csv` e `comprovantes/` | Um envio só, por e-mail ou WhatsApp |
| Modelo de dados | Livro-caixa calculado na hora (sem tabela de lançamentos) | Sem cópia para ficar desatualizada; o Carnê-Leão Web também permite corrigir meses passados |
| Recibo emitido | Tabela própria `health_receipts` | Pagamentos do Asaas são travados contra alteração pela tela (trigger `payments_guard_provider_rows`) |
| Tarifas do Asaas | Calculadas (`amount - net_amount`) e somadas ao custeio como "Tarifas de cobrança", sem registro novo | O dentista não lança à mão; confirmar a dedução com o contador |

## 4. Escopo

### Entra
- Financeiro → Despesas: lista do mês, nova despesa, editar, marcar como paga, anexar/trocar/ver comprovante, excluir.
- Financeiro → Livro-caixa: resumo mensal, alertas, recibos do Receita Saúde, botão "Baixar pacote do contador".
- Cadastro do paciente: seção "Responsável pelo pagamento (opcional)".
- Bucket privado de comprovantes; bucket de documentos do paciente passa a privado.

### Fica de fora (nesta versão)
- Cálculo do imposto estimado.
- "Fechar o mês" (congelar o resumo enviado).
- Tela do livro-caixa separada por dentista (o dado é guardado).
- Emissão automática no Receita Saúde.
- Despesas recorrentes automáticas (ex.: aluguel todo mês).
- Importação de extrato bancário.
- Perfis de acesso (quem pode ver o livro-caixa): todos da clínica veem, como o resto do Financeiro.

## 5. Categorias de despesa

Código guardado no banco → rótulo na tela → grupo padrão no Carnê-Leão.

| Código | Rótulo | Grupo padrão |
|---|---|---|
| `aluguel` | Aluguel e condomínio | `custeio` |
| `contas` | Luz, água, telefone e internet | `custeio` |
| `material` | Material odontológico | `custeio` |
| `laboratorio` | Laboratório de prótese | `custeio` |
| `servicos` | Contador e serviços de terceiros | `custeio` |
| `manutencao` | Manutenção e limpeza | `custeio` |
| `marketing` | Marketing e divulgação | `custeio` |
| `conselho` | Anuidade do CRO e associações | `custeio` |
| `iptu_taxas` | IPTU e taxas do consultório | `custeio` |
| `tarifas` | Tarifas bancárias e de cobrança | `custeio` |
| `salarios` | Salários e encargos de funcionários | `pessoal` |
| `emolumentos` | Cartório e emolumentos | `emolumentos` |
| `equipamentos` | Equipamentos e móveis | `null` (não dedutível) |
| `reformas` | Reformas e obras | `null` |
| `cursos` | Cursos e congressos | `null` |
| `outras` | Outras | `null` |

Rótulos dos grupos: `custeio` = "Despesas de custeio", `pessoal` = "Salários e encargos", `emolumentos` = "Emolumentos", `null` = "Não dedutível".

## 6. Banco de dados

Migração nova `supabase/2026-11-05-livro-caixa.sql`, re-executável, espelhada em `schema.sql`.

### `expenses` (colunas novas)
- `category` passa a aceitar só os códigos da §5 (`CHECK`). Migração: valores atuais que não são códigos viram `outras`, e o texto antigo vai para `notes` (concatenado se já houver nota).
- `deduction_group TEXT NULL CHECK (deduction_group IN ('custeio','pessoal','emolumentos'))`: preenchido pela tela a partir da categoria; `NULL` = não dedutível. Migração: despesas existentes recebem o grupo padrão da categoria migrada.
- `payment_method TEXT NULL` (mesmos valores de `payments.payment_method`, exceto `convenio`).
- `professional_id UUID NULL REFERENCES professionals(id) ON DELETE SET NULL`.
- `notes TEXT NULL`.
- `receipt_path TEXT NULL`: caminho no bucket `expense-receipts`.
- `receipt_name TEXT NULL`, `receipt_size BIGINT NULL`, `receipt_type TEXT NULL`.
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `paid_at` passa a ser gravado com `toDbPaidAt` (meio-dia UTC), como os pagamentos.

### `patients` (colunas novas)
- `payer_name TEXT NULL`, `payer_cpf TEXT NULL` (só dígitos, validado com `src/lib/payments/cpf.ts`).

### `health_receipts` (nova; RLS por clínica, como as demais tabelas)
- `payment_id UUID PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE`
- `clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE`
- `issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `issued_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL`
- Policies SELECT/INSERT/DELETE para `clinic_id IN (SELECT user_clinic_ids())`; o INSERT também exige que o pagamento seja da mesma clínica.
- Desmarcar = apagar a linha.

### Storage
- Bucket novo `expense-receipts`, **privado**. Caminho: `<clinic_id>/<expense_id>/<uuid>.<ext>`. Policies SELECT/INSERT/DELETE iguais às do `anneOdonto` (primeira pasta = clínica do usuário).
- Bucket `anneOdonto` passa a `public = false`.
- `documents.file_url` passa a guardar o **caminho** no bucket (`<clinic_id>/<patient_id>/<arquivo>`). Migração: linhas com URL pública viram o caminho (parte depois de `/storage/v1/object/public/anneOdonto/`).
- As telas geram links com `createSignedUrl` (validade: 1 hora) na hora de mostrar/abrir.

## 7. Apuração do mês (regras)

Mês = `YYYY-MM`. A data de um lançamento é a parte `YYYY-MM-DD` de `paid_at` (`fromDbPaidAt`).

**Receitas:** pagamentos com `status = 'paid'` e `paid_at` no mês. Pagamentos `refunded`, `cancelled`, `pending` e `overdue` ficam de fora.
- `payment_method = 'convenio'` → **Recebimentos de convênios** (informativo, fora do resultado).
- Os demais → **Receitas de pacientes** (entram no resultado e na lista de recibos).

**Despesas:** `expenses` com `status = 'paid'` e `paid_at` no mês.
- Somadas por `deduction_group`. `NULL` → **Não dedutíveis** (informativo).

**Tarifas de cobrança:** para cada receita de paciente com `net_amount` preenchido, `amount - net_amount` (só se positivo). A soma entra em `custeio`, numa linha própria "Tarifas de cobrança (Asaas)".

**Resultado do mês** = receitas de pacientes − (custeio + tarifas + pessoal + emolumentos). Pode ser negativo; mostrar como está.

Valores somados em centavos (`toCents`/`fromCents` de `src/lib/payments/money.ts`).

**Recibos:** um item por receita de paciente:
- pagador = `payer_name`/`payer_cpf` do paciente se `payer_cpf` preenchido; senão o próprio paciente (`name`/`cpf`);
- beneficiário = o paciente;
- valor = `amount` (bruto), data = data do pagamento;
- emitido = existe linha em `health_receipts`;
- sem CPF do pagador → item marcado com alerta.

**Alertas do mês:** recibos pendentes (quantidade), recibos sem CPF do pagador, despesas dedutíveis pagas sem comprovante.

## 8. Arquitetura

```
Tela Despesas ──(supabase-js + RLS)──> expenses, storage expense-receipts
Tela Livro-caixa ──> GET /api/livro-caixa/[mes] ──> livro-caixa/repo.ts ──> apuracao.ts ──> JSON
                 ──> POST/DELETE /api/livro-caixa/recibos/[paymentId] ──> health_receipts
                 ──> GET /api/livro-caixa/[mes]/exportar ──> apuracao.ts + exportacao.ts ──> .zip
```

### `src/lib/livro-caixa/`
- `categorias.ts`: lista da §5; `defaultGroup(code)`, `categoryLabel(code)`, `groupLabel(group)`.
- `mes.ts`: validação de `YYYY-MM`, primeiro/último dia, mês anterior/seguinte, nome do mês em português.
- `apuracao.ts`: funções puras `buildLedger({ month, payments, expenses, patients, receipts })` → `{ totals, rows, receipts, alerts }`. Sem banco.
- `exportacao.ts`: `toCsv(ledger)` (UTF-8 com BOM, separador `;`, decimal com vírgula, datas `DD/MM/AAAA`), `toPdf(ledger, clinic)` (pdf-lib), `toZip(files)` (fflate).
- `repo.ts`: consultas Supabase (clínica do usuário, pagamentos e despesas do mês, pacientes envolvidos, recibos, download dos comprovantes).

### Rotas
- `GET /api/livro-caixa/[mes]`: exige usuário logado; usa a clínica do usuário; devolve o ledger.
- `POST /api/livro-caixa/recibos/[paymentId]` e `DELETE` idem: marca/desmarca, só para pagamento da clínica do usuário com status `paid` e que não seja convênio.
- `GET /api/livro-caixa/[mes]/exportar`: devolve `livro-caixa-AAAA-MM.zip` com `resumo.pdf`, `lancamentos.csv` e `comprovantes/<data>-<descrição>-<id curto>.<ext>`. Se a soma dos comprovantes passar de 100 MB, gera sem a pasta e inclui `LEIA-ME.txt` explicando; a tela mostra o aviso.

Rotas usam o cliente Supabase do usuário (RLS) para dados; o download de comprovantes também.

### `lancamentos.csv`
Colunas: `Data;Tipo;Descrição;Categoria;Grupo Carnê-Leão;Valor;Pagador;CPF do pagador;Paciente;Recibo emitido;Comprovante`. Tipo ∈ {Receita de paciente, Convênio, Despesa, Tarifa de cobrança}.

### Bibliotecas novas
`pdf-lib` e `fflate` (JavaScript puro, funcionam no servidor do Next).

## 9. Telas

### Financeiro → Despesas
- Seletor de mês; lista com descrição, categoria, valor, vencimento, situação (a pagar/paga) e ícone de clipe quando há comprovante.
- "Nova despesa": descrição*, valor*, categoria*, grupo do Carnê-Leão (preenchido pela categoria; link "alterar"), vencimento, "já foi paga" + data de pagamento, forma de pagamento, dentista (opcional), comprovante (`accept="image/jpeg,image/png,image/webp,application/pdf"`, `capture` no celular), observação.
- Ações: marcar como paga (pede a data, padrão hoje), editar, anexar/trocar comprovante, ver comprovante (link temporário), excluir (apaga o comprovante também).
- Comprovante: até 10 MB. Se o envio falhar, a despesa fica salva e aparece "Comprovante não enviado. Tente anexar de novo."

### Financeiro → Livro-caixa
- Seletor de mês (padrão: mês atual).
- Quadro: Receitas de pacientes; Despesas dedutíveis (custeio com tarifas, salários e encargos, emolumentos); Resultado do mês; informativos (convênios, não dedutíveis).
- Aviso fixo: "Valores para conferência. O cálculo oficial do imposto é feito no Carnê-Leão Web."
- Alertas com contagem e link para a lista correspondente.
- Recibos do Receita Saúde: data, pagador (nome, CPF), paciente (nome, CPF), valor, botões copiar CPF/valor, "Marcar como emitido"/"Desfazer", filtro "Só pendentes". Sem CPF: alerta com link para o cadastro do paciente.
- Botão "Baixar pacote do contador".

### Paciente
- Seção "Responsável pelo pagamento (opcional)": nome e CPF (validado).

### Documentos do paciente
- Mesmo visual; imagens, miniaturas de PDF e links usam links temporários.

## 10. Erros (o que o usuário vê)

| Situação | Mensagem |
|---|---|
| Mês inválido na rota | 400, "Mês inválido" |
| Usuário sem clínica | 403, "Sem clínica vinculada" |
| Marcar recibo de pagamento de outra clínica/inexistente | 404, "Pagamento não encontrado" |
| Marcar recibo de convênio ou não pago | 422, "Este pagamento não precisa de recibo no Receita Saúde" |
| Comprovante maior que 10 MB ou tipo não aceito | Na tela, antes de enviar: "Envie JPG, PNG, WEBP ou PDF de até 10 MB" |
| Falha ao gerar o pacote | 500, "Não foi possível gerar o pacote. Tente novamente." |
| CPF do responsável inválido | Na tela: "CPF inválido" |

## 11. Testes

Vitest, no padrão atual:
- `apuracao`: mês certo pela data (inclui último dia do mês e virada de ano); pendentes/cancelados/estornados fora; convênio separado; tarifas = `amount - net_amount`, ignoradas se nulas ou ≤ 0; grupos e troca de grupo; despesa não paga fora; resultado negativo; soma em centavos sem erro de arredondamento.
- Recibos: pagador = responsável quando há `payer_cpf`; senão o paciente; sem CPF → alerta; emitido/pendente.
- `exportacao`: CSV com BOM, `;`, vírgula decimal e acentos; zip contém `resumo.pdf`, `lancamentos.csv` e os comprovantes; limite de 100 MB gera `LEIA-ME.txt`.
- `categorias`: todo código tem rótulo e grupo; `defaultGroup` correto.
- Rotas de recibo: recusa outra clínica, convênio e não pago.
- Migração: conferência manual no SQL Editor (categorias antigas → `outras` com nota; `file_url` → caminho).

Teste final com o usuário: despesas com foto pelo celular, resumo de novembro (com os pagamentos dos testes do Asaas), recibos, pacote aberto no Excel, documentos do paciente abrindo depois do bucket privado.

## 12. Próximos passos (fora deste projeto)
- Estimativa do imposto com a tabela mensal.
- Fechar o mês.
- Livro-caixa por dentista.
- Despesas recorrentes e importação de extrato.
