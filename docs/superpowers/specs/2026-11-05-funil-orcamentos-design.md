# Funil de orçamentos e assinatura eletrônica: Design

**Data:** 2026-11-05
**Status:** aprovado em conversa, aguardando revisão da especificação
**Roteiro:** item 4 (abre a Fase 2). Usa o WhatsApp automático (item 1) e a cobrança Asaas (item 2).

## 1. Objetivo

Hoje o orçamento fica na aba do paciente, sem dentista responsável, sem data de envio e sem forma de o paciente aprovar à distância. A clínica não sabe quantos orçamentos ficaram parados, nem quanto deixa de faturar, nem por quê.

Este projeto entrega:
- envio do orçamento pelo WhatsApp com um link onde o paciente escolhe os itens e assina;
- lembretes automáticos para quem não respondeu e uma lista "Para ligar" para a recepção, com registro do motivo das perdas;
- uma página "Orçamentos" com os números do funil (apresentado, aprovado, taxa por dentista, tempo até aprovar, motivos de perda) e listas por etapa;
- atalho para gerar a cobrança no Asaas com o valor aprovado.

**Sucesso significa:**
- A recepção envia um orçamento em um clique e o paciente aprova pelo celular sem criar conta.
- Nenhum orçamento enviado fica esquecido: ou o paciente decide, ou ele aparece em "Para ligar", ou vence.
- O dono vê, por mês e por dentista, quanto foi apresentado, quanto foi aprovado e por que se perdeu.
- A assinatura guarda prova suficiente para um contrato entre particulares (quem, quando, de onde, o quê) e nada muda depois de assinado.

## 2. Fatos que orientam o desenho

- A Lei 14.063/2020 admite assinatura eletrônica simples em documentos entre particulares. A prova se apoia em identificação do signatário, data e hora, origem (IP, aparelho) e integridade do conteúdo.
- O app já tem fila de mensagens com horários de envio, modelos configuráveis e rotina (cron) que agenda lembretes por dias (`message_settings.config.offset_days`, usado pelo `payment_due`).
- O app já cria cobranças no Asaas a partir de um orçamento (`payments.budget_id`, `ModalNovaCobranca`).
- Os orçamentos são gravados direto pelo navegador (Supabase com RLS). Regras que precisam valer sempre (travar orçamento assinado, desativar link ao editar) ficam no banco, em gatilhos.

## 3. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Assinatura | Própria do app agora; desenho com "provedor de assinatura" para ligar ZapSign/Clicksign depois | Sem custo por documento, sem conta extra; não fecha a porta para prova mais forte |
| Paciente parado | Lembretes automáticos (dias 3 e 7, configuráveis) e depois lista "Para ligar" com registro de contato e motivo | Não depende de alguém lembrar; os motivos explicam as perdas |
| Aprovação parcial | Paciente escolhe item por item; assinatura cobre só os itens escolhidos | Reflete como o paciente decide; taxa em reais fica fiel |
| Pagamento após aprovar | A clínica gera a cobrança (valor aprovado já preenchido); a aprovação passa por uma única função para que a escolha de pagamento pelo paciente entre depois | Negociação fica com a clínica; caminho preparado |
| Tela | Página "Orçamentos": indicadores no alto e abas por etapa; filtro por período e dentista | Funciona no celular; etapas que mudam sozinhas não combinam com arrastar |
| Link do paciente | Página pública no app, com código aleatório longo | Base da assinatura própria |
| Guarda do código do link | Código guardado como é, em tabela sem acesso pelo navegador (só o servidor lê) | Lembretes e "Copiar link" precisam reenviar o mesmo link. **Muda o que foi dito na conversa** (guardar só versão embaralhada): com o código embaralhado não dá para reenviar o mesmo link |

## 4. Escopo

### Entra
- Dentista responsável, validade e datas do funil no orçamento.
- Envio, reenvio e "Copiar link"; página pública de aprovação e recusa; comprovante em PDF.
- Lembretes automáticos e vencimento automático.
- Lista "Para ligar" com registro de contato; aprovação pela recepção (por telefone).
- Página "Orçamentos" com indicadores e abas.
- Histórico do orçamento (envios, lembretes, visualizações, contatos, decisão).
- Atalho "Gerar cobrança" com o valor aprovado menos o já cobrado.

### Fica de fora (nesta versão)
- Paciente escolher a forma de pagamento no link (preparado: ver seção 8).
- Assinatura por serviço externo (preparado: campo `provider` e interface).
- Opções alternativas montadas pelo dentista ("plano completo" e "plano essencial").
- Painel geral de indicadores da clínica (item 9).
- Envio por e-mail.

## 5. Etapas e regras

Status do orçamento: `draft` (Rascunho) → `sent` (Enviado) → `approved` (Aprovado) | `rejected` (Perdido: recusado) | `expired` (Perdido: vencido). `completed` (Concluído) continua para tratamento terminado e só vem de `approved`.

"Visualizado" não é status: é a data `viewed_at` de um orçamento `sent`.

| Ação | De | Para | Efeitos |
|---|---|---|---|
| Enviar | draft | sent | cria link novo (desativa o anterior), `sent_at = agora` se vazio, `valid_until` = hoje + validade se vazio, manda WhatsApp |
| Reenviar | sent | sent | mesmo link; manda WhatsApp de novo; não muda `sent_at` |
| Editar itens, total ou validade | sent | draft | desativa o link (gatilho no banco) |
| Paciente assina | sent | approved | marca itens aprovados, `approved_total`, `decided_at`; desativa link; grava assinatura |
| Paciente recusa | sent | rejected | `lost_reason` (opcional, padrão `outro`), `decided_at`; desativa link |
| Recepção: aprovou por telefone | sent ou draft | approved | igual à assinatura, com `provider = 'reception'` e o usuário que aprovou |
| Recepção: perdido | sent ou draft | rejected | motivo obrigatório |
| Vencer (rotina) | sent, `valid_until` < hoje | expired | `lost_reason = 'sem_resposta'`, `decided_at`; desativa link |
| Reabrir | rejected ou expired | draft | limpa `decided_at`, `lost_reason`, `followup_at`; mantém `sent_at` |

Regras:
- Orçamento `approved` ou `completed` fica travado: o banco recusa mudar itens (procedimento, dente, quantidade, preço, aprovado) e total. Só o andamento do item (`budget_items.status`) e as observações continuam editáveis.
- Orçamento sem itens ou com total zero não pode ser enviado.
- Paciente sem telefone: "Enviar" só gera o link (para copiar); o app avisa.
- WhatsApp desconectado: o link é criado e o app mostra "Copiar link" com o aviso.
- Validade padrão: 30 dias (configurável por clínica, de 1 a 180).
- Reabrir e enviar de novo mantém o `sent_at` original: o orçamento continua contado no mês em que foi apresentado pela primeira vez.

**Motivos de perda (lista fixa):** `preco` (Achou caro), `pensar` (Vai pensar), `outro_lugar` (Fez em outro lugar), `tempo` (Sem tempo), `medo` (Medo ou ansiedade), `sem_resposta` (Sem resposta), `outro` (Outro).

**Para ligar:** orçamento `sent` em que (a) o último lembrete configurado já passou (data de envio + maior dia de lembrete), ou não há lembretes ativos e passaram 7 dias do envio, ou (b) foi visualizado há 2 dias ou mais e não foi decidido; e `followup_at` está vazio ou já chegou.

**Registrar contato** (resultados):
- `nao_atendeu`: `followup_at` = amanhã.
- `pensar`: `followup_at` = data escolhida (padrão: daqui a 3 dias).
- `aprovou`: abre a escolha de itens e aprova pela recepção.
- `perdido`: pede o motivo e muda para `rejected`.
Todo contato grava um evento com observação opcional.

## 6. Banco de dados

Migração `supabase/2026-11-05-funil-orcamentos.sql` (pode rodar mais de uma vez), espelhada em `supabase/schema.sql`.

### `budgets` (colunas novas)
`professional_id` (FK professionals, SET NULL), `sent_at`, `viewed_at`, `decided_at`, `valid_until` (DATE), `approved_total` NUMERIC(10,2), `lost_reason` (CHECK na lista acima), `followup_at` (DATE), `approval_seen_at`, `updated_at`. Status CHECK passa a `('draft','sent','approved','rejected','expired','completed')`.

Dados existentes: `approved` e `completed` recebem `approved_total = total`, itens `approved = true`, `decided_at = created_at`. `rejected` recebe `lost_reason = 'outro'`, `decided_at = created_at`. Sem `sent_at`, os antigos não entram nos números do funil.

### `budget_items` (coluna nova)
`approved` BOOLEAN (nulo até a decisão).

### `clinics` (coluna nova)
`budget_validity_days` INTEGER NOT NULL DEFAULT 30, CHECK 1 a 180.

### `budget_links` (nova; sem policy para o navegador, só o servidor acessa)
`id`, `budget_id`, `clinic_id`, `token` TEXT UNIQUE (32 bytes aleatórios em base64url), `created_at`, `revoked_at`, `view_count`, `failed_attempts`, `locked_until`. No máximo um link ativo (`revoked_at` nulo) por orçamento (índice único parcial).

### `budget_signatures` (nova; membros da clínica leem; escrita só pelo servidor)
`budget_id` PK, `clinic_id`, `provider` (`app` | `reception`; aberto para `zapsign` etc. no futuro), `provider_ref`, `signer_name`, `signer_cpf`, `snapshot` JSONB, `document_hash` (SHA-256 hex), `ip`, `user_agent`, `signed_at`, `approved_by` (usuário, na aprovação pela recepção).

`snapshot` (JSON canônico, chaves em ordem fixa): clínica, paciente (nome), dentista, número e data do orçamento, validade, itens aprovados (procedimento, dente, quantidade, preço unitário, subtotal), itens não aprovados (procedimento), total aprovado, nome e CPF de quem assinou, data e hora. `document_hash = sha256(snapshot canônico)`.

### `budget_events` (nova; membros da clínica leem e inserem contatos; demais eventos só pelo servidor)
`id`, `budget_id`, `clinic_id`, `type` (`sent`, `resent`, `reminder`, `viewed`, `contact`, `approved`, `rejected`, `expired`, `reopened`, `edited`), `outcome` (para `contact`), `reason`, `note`, `created_by`, `created_at`. `viewed` é gravado só na primeira visualização de cada link.

### Mensagens
- Tipo novo `budget` em `messages` (envio e reenvio) e `budget_reminder` em `messages` e `message_settings` (`config.offset_days`, padrão `[3, 7]`, ligado por padrão quando o WhatsApp está configurado).
- Modelos padrão:
  - `budget`: "Olá, {paciente}! Segue seu orçamento da {clinica}, no valor de {valor}. Para ver os detalhes e aprovar: {link}"
  - `budget_reminder`: "Olá, {paciente}! Seu orçamento na {clinica} ainda está disponível até {vencimento}. Para ver e aprovar: {link}"
- `messages.budget_id` (FK, SET NULL) para o histórico. Chave de deduplicação dos lembretes: `budget_reminder:<budget_id>:<link_id>:<dia>` (reenviar com link novo reinicia os lembretes).

### Gatilhos
- `budgets`/`budget_items` em orçamento `sent`: mudança em itens, total ou `valid_until` volta o status para `draft`, desativa o link e grava evento `edited`.
- `budgets`/`budget_items` em orçamento `approved` ou `completed`: recusa mudança nos campos travados (seção 5).

### Policies
Seguem `user_clinic_ids()`. `budget_links` sem nenhuma policy (só service role). `budget_signatures`: select. `budget_events`: select; insert só `type = 'contact'` e `created_by = auth.uid()`.

## 7. Página do paciente (pública)

Endereço: `{APP_URL}/orcamento/{token}`. O `proxy.ts` deixa passar `/orcamento/` e `/api/public/` sem login e sem redirecionar quem está logado.

Mostra: nome e logo da clínica, dentista, número e data, validade, itens com caixa de marcar (todos marcados de início), total recalculado. Não mostra CPF nem telefone. Campos: nome completo, CPF, "Li e concordo com os itens selecionados". Botões "Assinar e aprovar" e "Não quero seguir" (motivo opcional).

Regras de segurança:
- Código inexistente, desativado, de orçamento decidido ou vencido: página "Este link não está mais disponível. Fale com a clínica." sem dados do paciente. Exceção: orçamento aprovado mostra "Orçamento aprovado em {data}" e o botão do comprovante, mas só durante 30 dias após a assinatura.
- CPF precisa ser válido e igual ao do paciente ou ao do responsável pelo pagamento (`payer_cpf`); se o paciente não tem nenhum dos dois, qualquer CPF válido serve.
- 5 tentativas com CPF errado bloqueiam a assinatura daquele link por 1 hora (`failed_attempts`, `locked_until`).
- Pelo menos um item marcado.
- Assinatura e recusa conferem, na mesma transação, que o orçamento ainda está `sent` e o link ativo (duas abas não assinam duas vezes).
- `ip` do cabeçalho `x-forwarded-for` (primeiro valor) e `user_agent` como vieram, cortados em 300 caracteres.
- Cabeçalhos `Cache-Control: no-store` e `X-Robots-Tag: noindex`.

Comprovante em PDF (pdf-lib, como no livro-caixa): dados do snapshot, a frase "Assinado eletronicamente (Lei 14.063/2020, assinatura simples)", data e hora, IP, aparelho e o hash. Disponível para a clínica sempre e para o paciente pelo link durante 30 dias.

## 8. Arquitetura

### `src/lib/orcamentos/`
- `etapas.ts`: regras puras de transição (seção 5); `canSend`, `transition(budget, action)` devolve o novo estado ou erro.
- `funil.ts`: `buildFunnel(budgets, filtros)` → totais do período, por dentista, tempo médio, motivos. Período pela data `sent_at`.
- `paraLigar.ts`: `needsCall(budget, now, reminderDays)`.
- `assinatura.ts`: `buildSnapshot`, `canonicalJson`, `hashSnapshot`, `checkSignerCpf`, `SignatureProvider` (implementação `app`).
- `aprovacao.ts`: `approveBudget(input, deps)` (único ponto de aprovação, usado pela página pública e pela recepção; é aqui que a escolha de pagamento entra no futuro), `rejectBudget`, `expireBudgets`.
- `links.ts`: criar, buscar e desativar link; limite de tentativas.
- `comprovante.ts`: PDF.
- `repo.ts`: acesso ao banco.

### Rotas
- `POST /api/orcamentos/[id]/enviar` (envia ou reenvia; devolve link e se a mensagem foi para a fila)
- `GET /api/orcamentos/[id]/link` (Copiar link)
- `POST /api/orcamentos/[id]/decisao` (recepção: aprovar com itens, ou perder com motivo; reabrir)
- `GET /api/orcamentos/[id]/comprovante`
- `GET /api/orcamentos/funil?de=&ate=&dentista=`
- `GET /api/public/orcamento/[token]`, `POST /api/public/orcamento/[token]/assinar`, `POST /api/public/orcamento/[token]/recusar`, `GET /api/public/orcamento/[token]/comprovante`
- Rotina existente `/api/cron/messages`: agenda `budget_reminder` e vence orçamentos (`expireBudgets`).

### Telas
- **Menu → Orçamentos** (`src/app/(dashboard)/orcamentos/page.tsx`): filtros (período, padrão mês atual; dentista); cartões Apresentado, Aprovado, Taxa (R$ e quantidade), Tempo médio; tabela por dentista; motivos de perda; abas Enviados, Para ligar, Aprovados, Perdidos. Contador no item de menu: aprovados com `approval_seen_at` vazio (zera ao abrir a aba Aprovados).
- **Paciente → Orçamentos**: etapa, dentista, validade, botões Enviar, Reenviar, Copiar link, Gerar cobrança, Comprovante, Reabrir, e o histórico.
- **Mensagens**: modelos `budget` e `budget_reminder` e dias dos lembretes, junto aos demais.
- **Configurações da clínica**: validade padrão dos orçamentos.

## 9. Erros (o que o usuário vê)

| Situação | Mensagem |
|---|---|
| Enviar sem itens | "Adicione ao menos um item com valor antes de enviar" |
| Paciente sem telefone | "Paciente sem telefone. Copie o link e envie por outro meio." |
| WhatsApp desconectado | "WhatsApp desconectado. O link foi criado: copie e envie por outro meio." |
| Editar orçamento aprovado | "Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo." |
| Paciente: CPF inválido | "CPF inválido" |
| Paciente: CPF diferente | "O CPF não confere com o cadastro. Confira ou fale com a clínica." |
| Paciente: bloqueado | "Muitas tentativas. Tente de novo em 1 hora ou fale com a clínica." |
| Paciente: nenhum item | "Selecione ao menos um item" |
| Paciente: já decidido em outra aba | "Este orçamento já foi respondido." |
| Recepção: perdido sem motivo | "Escolha o motivo" |

## 10. Testes

- `etapas`: cada transição permitida e proibida da seção 5.
- `funil`: período por `sent_at`; taxa em R$ e em quantidade; parcial conta o valor aprovado; reabertura não conta duas vezes; por dentista com "Sem dentista"; tempo médio; motivos.
- `paraLigar`: dias de lembrete, sem lembretes, visualizado há 2 dias, `followup_at` futuro e vencido.
- `assinatura`: JSON canônico estável (mesma entrada, mesmo hash; ordem de chaves); CPF do paciente, do responsável e sem cadastro.
- `links`: código com 43 caracteres base64url; bloqueio após 5 erros; desbloqueio após 1 hora.
- `aprovacao`: itens marcados, `approved_total`, link desativado, segunda assinatura recusada, aprovação pela recepção.
- Agendamento dos lembretes (chave por link e dia; para quando decide).
- Migração: colunas, CHECKs, gatilhos e policies presentes no SQL.
- Teste manual: enviar ao próprio WhatsApp, abrir no celular, desmarcar um item, assinar, baixar o comprovante, conferir o funil, registrar contato num segundo orçamento, gerar cobrança.

## 11. Próximos passos (fora deste projeto)
- Paciente escolhe a forma de pagamento no link e a cobrança sai na hora.
- Provedor de assinatura externo (ZapSign, Clicksign).
- Planos alternativos no mesmo orçamento.
- Painel geral de indicadores (item 9).
