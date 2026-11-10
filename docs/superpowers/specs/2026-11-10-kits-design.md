# Kits de material e baixa por procedimento (Estoque, fase 2)

Data: 2026-11-10. Branch: `feat/kits`. Continua a fase 1 do Estoque (`docs/superpowers/specs/2026-11-10-estoque-design.md`, já na main).

## Objetivo

Quando um tratamento é concluído, o material gasto sai do estoque sem digitação manual. A clínica cadastra kits ("Restauração resina": 1 tubete, 1 par de luvas...). Ao concluir, o sistema sugere um kit, a pessoa ajusta se precisar e confirma.

Critérios de sucesso:
- concluir um tratamento abre a janela de baixa, com o kit sugerido;
- confirmar baixa todos os materiais de uma vez, ou nenhum se faltar saldo;
- tratamentos concluídos sem baixa ficam marcados como "Material pendente" até alguém resolver;
- tirar o "Concluído" de um tratamento que teve baixa pergunta se o material volta ao estoque.

## Decisões do usuário

| Tema | Decisão |
|---|---|
| Ligação | Escolher o kit ao concluir. O sistema sugere e a pessoa confirma ou troca. O cadastro de tratamentos não muda. |
| Confirmação | Mostrar o kit e permitir ajustes (trocar kit, mudar quantidades, incluir ou tirar itens) ou recusar. |
| Desfazer | Ao tirar o "Concluído", perguntar se devolve. "Sim" gera uma Devolução ligada ao tratamento. "Não" mantém a baixa. |
| Abordagem | A baixa é um passo próprio depois da conclusão. Um gatilho só marca o tratamento como pendente; a baixa em si exige confirmação. |

## Fora do escopo

- tratamentos concluídos antes desta migração não ficam pendentes;
- baixa por consulta na Agenda;
- custo de material por procedimento e relatórios;
- lista própria de procedimentos da clínica;
- quantidades fracionadas (continuam inteiras, como na fase 1);
- exclusão de kits (só desativar). O app não exclui tratamentos; quando um paciente é apagado, as movimentações perdem a ligação com o tratamento (`ON DELETE SET NULL`) e o estoque não muda.

## Dados — `supabase/2026-11-10-kits.sql`

A migração pode ser rodada mais de uma vez. Rode depois de `2026-11-10-estoque.sql`. O mesmo conteúdo é acrescentado ao fim de `supabase/schema.sql`.

### `inventory_kits`
- `id`, `clinic_id` (FK clinics, cascade), `name TEXT NOT NULL`, `active BOOLEAN NOT NULL DEFAULT true`, `created_at`, `updated_at`.
- Índice único `(clinic_id, lower(btrim(name)))`.
- RLS `clinic_member`, no mesmo padrão de `inventory_lots`.

### `inventory_kit_items`
- `id`, `clinic_id`, `kit_id` (FK inventory_kits, cascade), `item_id` (FK inventory_items, cascade).
- `quantity INTEGER NOT NULL CHECK (quantity > 0)`.
- `UNIQUE (kit_id, item_id)`.
- RLS `clinic_member`.

### `treatments`: colunas novas
- `material_status TEXT`, com `CHECK (material_status IS NULL OR material_status IN ('pendente','baixado','dispensado'))`.
- `material_kit_id UUID REFERENCES inventory_kits(id) ON DELETE SET NULL`.

### `inventory_movements`: coluna nova
- `treatment_id UUID REFERENCES treatments(id) ON DELETE SET NULL`.
- Índice `(treatment_id)`.

### Gatilho `treatments_material_status`: BEFORE INSERT OR UPDATE ON treatments

**Mudança vinda das funções abaixo:** elas fazem `SET LOCAL app.material = 'on'` e o gatilho aceita os valores enviados.

**Qualquer outra gravação** (navegador, IA, aprovação de orçamento):
1. Primeiro, o gatilho ignora tentativas de mudar `material_status` e `material_kit_id`. Num INSERT, os dois começam nulos; num UPDATE, mantêm os valores antigos.
2. Depois, vê se o status passou a ser `completed`: num INSERT, se já entra concluído; num UPDATE, se antes não estava. Nesse caso, se `material_status` está nulo, vira `pendente`.
3. Por fim, vê se o tratamento deixou de estar concluído (UPDATE com OLD `completed` e NEW diferente). Se o material estava `pendente` ou `dispensado`, volta a nulo. Se estava `baixado`, não muda: a devolução é uma pergunta separada.

Um tratamento `baixado` que é reconcluído continua `baixado`, sem nova baixa.

### Funções (SECURITY DEFINER, `search_path = public`, só `service_role`)

**`create_inventory_kit(p_clinic_id, p_data JSONB) RETURNS UUID`** e **`update_inventory_kit(p_clinic_id, p_id, p_data JSONB) RETURNS VOID`**
- `p_data` traz `{name, active, items: [{item_id, quantity}]}`. Na edição, `items` substitui a lista inteira.
- Os produtos precisam ser da mesma clínica; senão, `PRODUTO_INVALIDO`.
- Quantidade inválida gera `QUANTIDADE_INVALIDA`. Produto repetido gera `ITEM_REPETIDO`. Nenhum item gera `KIT_VAZIO`.
- Kit de outra clínica ou inexistente gera `KIT_NAO_ENCONTRADO`. Nome repetido sobe como erro 23505.
- Produtos inativos são aceitos no kit; a baixa é que recusa.

**`treatment_material_apply(p_clinic_id, p_user_id, p_treatment_id, p_kit_id, p_items JSONB) RETURNS JSONB`**
- Trava o tratamento com `FOR UPDATE` e filtro por clínica. Se não existir, `TRATAMENTO_NAO_ENCONTRADO`. Se não estiver `completed`, `TRATAMENTO_NAO_CONCLUIDO`. Se `material_status` não for `pendente`, `MATERIAL_JA_RESOLVIDO`.
- `p_kit_id` é opcional. Se vier, precisa ser da clínica (`KIT_NAO_ENCONTRADO`). Fica só como registro: a lista que vale é `p_items`.
- `p_items` é `[{item_id, quantity}]`, com 1 a 50 itens, sem repetição e quantidade > 0. Senão, `QUANTIDADE_INVALIDA`, `ITEM_REPETIDO` ou `KIT_VAZIO`.
- Processa os itens em ordem crescente de `item_id`, para as travas sempre na mesma ordem. Para cada um, chama `inventory_exit(p_clinic_id, p_user_id, item, qtd, 'uso', NULL, nota)`. A nota é `left('Tratamento: ' || procedure, 200)`.
- `inventory_exit` não é modificado. Depois de cada chamada, o vínculo é gravado com `UPDATE inventory_movements SET treatment_id = p_treatment_id`, só nas linhas que essa chamada criou: `WHERE clinic_id = p_clinic_id AND item_id = <item> AND type = 'out' AND treatment_id IS NULL AND created_at = now()`. Dentro de uma transação, `now()` é o mesmo valor do default de `created_at`, e cada produto aparece uma vez só na lista, então nenhuma outra linha casa.
- Se `inventory_exit` falhar, a função relança como `<CODIGO>:<item_id>` (por exemplo `ESTOQUE_INSUFICIENTE:<uuid>`) e nada é gravado.
- No sucesso, faz `SET LOCAL app.material='on'` e atualiza o tratamento com `material_status='baixado'` e `material_kit_id=p_kit_id`.
- Devolve `{"itens": [{"item_id","quantidade","lotes":[...]}]}`.

**`treatment_material_skip(p_clinic_id, p_treatment_id) RETURNS VOID`**
- Faz `pendente` virar `dispensado`.
- Erros: `TRATAMENTO_NAO_ENCONTRADO`; `MATERIAL_JA_RESOLVIDO` quando o status não é `pendente`.

**`treatment_material_return(p_clinic_id, p_user_id, p_treatment_id) RETURNS JSONB`**
- Trava o tratamento. Se não existir, `TRATAMENTO_NAO_ENCONTRADO`. Se `material_status` não for `baixado`, `MATERIAL_NAO_BAIXADO`.
- Para cada saída `type='out'` com esse `treatment_id` e ainda não devolvida (isto é, criada depois da última devolução desse tratamento):
  - trava o produto;
  - se o produto controla validade e o lote original ainda existe, soma a quantidade nesse lote;
  - se o lote não existe mais e o produto controla validade, cria um lote "Devolução" sem código e sem validade;
  - se o produto não controla validade, soma direto no saldo.
- Recalcula o saldo, mantendo a regra da fase 1: para produto com validade, saldo = soma dos lotes.
- Grava, para cada saída, uma movimentação `in` / `devolucao` com o mesmo `treatment_id` e a nota `left('Devolução: ' || procedure, 200)`. Funciona também com produto inativo.
- Por fim, faz `SET LOCAL app.material='on'`. O tratamento volta a `material_status = NULL` se não estiver concluído, ou a `pendente` se estiver. Também limpa `material_kit_id`.
- Devolve `{"devolvidos": n}`.
- Uma segunda chamada recebe `MATERIAL_NAO_BAIXADO`, então a devolução nunca é duplicada.

## Regras puras — `src/lib/kits/`

**`sugestao.ts`**: `sugerirKit(procedimento, kitsAtivos, ultimoKitId?)`
1. Se `ultimoKitId` existir e for ativo, usa esse kit. Ele vem do último tratamento `baixado` da clínica com o mesmo procedimento, comparando sem acento, sem diferenciar maiúsculas e com espaços normalizados.
2. Senão, usa o kit ativo de nome mais longo que esteja contido no texto do procedimento, com a mesma normalização.
3. Senão, `null`.

**`validar.ts`**:
- `parseKit(raw)` aceita `name` (1–80 caracteres, sem espaços nas pontas), `active` (boolean, obrigatório na edição) e `items` (1–50 itens, `itemId` uuid, `quantity` inteiro de 1 a 9999, sem repetir produto).
- `parseBaixa(raw)` aceita `kitId` (uuid ou null) e `items` com as mesmas regras.

**`rotas.ts`**: tabela `ERROS_KITS`, que traduz os códigos para mensagens.
- `ESTOQUE_INSUFICIENTE:<id>` vira 409 "Saldo insuficiente de <nome do produto>". A rota busca o nome.
- `MATERIAL_JA_RESOLVIDO` vira 409 "A baixa deste tratamento já foi resolvida".
- `MATERIAL_NAO_BAIXADO` vira 409 "Este tratamento não tem baixa para devolver".
- `TRATAMENTO_NAO_CONCLUIDO` vira 409.
- `PRODUTO_INATIVO:<id>` vira 409 "<nome> está inativo".
- 23505 vira 409 "Já existe um kit com esse nome".
- Os demais códigos de validação viram 422.

**`repo.ts`**: `createKitsRepo(admin)`, no mesmo padrão da fase 1.

## API

Todas as rotas usam `withClinic`, `force-dynamic` e `params: Promise<…>`.

| Rota | Faz |
|---|---|
| `GET /api/estoque/kits` | Kits da clínica com itens (produto: nome, unidade, saldo, ativo) |
| `POST /api/estoque/kits` | Cria um kit. Responde 201 `{id}` |
| `PATCH /api/estoque/kits/[id]` | Edita nome, ativo e a lista inteira de itens |
| `GET /api/tratamentos/[id]/material` | `{tratamento: {id, procedure, status, material_status, patient}, sugestao: kitId \| null, kits: [...ativos com itens], movimentos: [...saídas desse tratamento]}` |
| `POST /api/tratamentos/[id]/material` | Dá a baixa. Recebe o corpo de `parseBaixa` |
| `POST /api/tratamentos/[id]/material/dispensar` | Marca "não usar material" |
| `POST /api/tratamentos/[id]/material/devolver` | Devolve o material ao estoque |
| `GET /api/tratamentos/material/pendentes?paciente=<uuid>` | Ids dos tratamentos `pendente` do paciente. Usado depois da evolução com IA |

## Telas

**Estoque, aba "Kits"** (`src/components/kits/TabKits.tsx`). Fica ao lado de Produtos e Histórico.
- Lista os kits ativos primeiro, com nome e quantidade de itens. Mostra o aviso "Saldo baixo" quando algum item tem saldo menor que a quantidade do kit ou o produto está inativo.
- Tem o botão "Novo kit". Clicar num kit abre a edição.
- **`ModalKit`** traz o nome, a situação ativo/inativo (só na edição) e os itens. Cada item tem uma busca de produto (só ativos, na mesma lista da tela de Estoque), a quantidade e o botão de remover.

**Janela "Baixa de material"** (`src/components/kits/ModalBaixaMaterial.tsx`). Recebe `treatmentId` e `onClose(resolvido: boolean)`.
- No topo: paciente e procedimento. Logo abaixo, um seletor de kit que já vem com o sugerido; trocar o kit substitui a tabela.
- A tabela mostra produto, quantidade editável, saldo atual e o botão remover. Tem também "Incluir produto".
- Produto com saldo menor que a quantidade fica marcado em vermelho, e "Dar baixa" fica desabilitado enquanto isso acontecer. Se o servidor responder 409, a mensagem aparece e a linha do produto fica marcada.
- Botões:
  - **Dar baixa**;
  - **Agora não**: fecha e o tratamento continua pendente;
  - **Não usar material**: dispensa.
- Sem nenhum kit cadastrado, a janela convida a cadastrar ou incluir produtos avulsos.

**Aba Tratamentos da ficha** (`TabTratamentos.tsx`):
- **Depois de salvar** um tratamento novo como `completed`, ou de passar um existente para `completed`, abre `ModalBaixaMaterial` se o tratamento ficou `pendente`.
- **Etiqueta "Material pendente"** com o botão "Dar baixa" nos concluídos `pendente`.
- **Nos `baixado`,** uma etiqueta discreta "Material baixado".
- **Ao editar um `baixado` para outro status,** antes de salvar, aparece a pergunta "Este tratamento teve baixa de material. Devolver o material ao estoque?" com três respostas:
  - **Devolver**: chama a devolução e salva;
  - **Manter baixa**: salva sem devolver;
  - **Cancelar**: não salva.

**Evolução** (`ModalEvolucao.tsx`). Depois de salvar com sucesso, chama `pendentes?paciente=` e abre `ModalBaixaMaterial` para cada id, um depois do outro. "Agora não" passa para o próximo.

**Histórico do Estoque**:
- movimentos com `treatment_id` mostram "Tratamento: <procedimento> — <paciente>", com link para a ficha do paciente;
- o filtro de tipo continua o mesmo.

## Testes

- **Regras puras:** `tests/kits/sugestao.test.ts`, `validar.test.ts`, `rotas.test.ts` (inclui `ESTOQUE_INSUFICIENTE:<id>` com o nome do produto).
- **Acesso ao banco e rotas:** `tests/kits/repo.test.ts` e testes das rotas, usando `fakeAdmin` e `rpc=vi.fn()`.
- **SQL:** verificado ao vivo pelo controlador depois que o usuário rodar a migração:
  - baixa com saldo suficiente;
  - baixa sem saldo, que não altera nada;
  - gatilho para pendente, para nulo e mantendo `baixado`;
  - devolução para o mesmo lote;
  - segunda devolução recusada.
- **Navegador** (feito pelo controlador, com os dados de teste apagados depois):
  - criar kit;
  - concluir tratamento e confirmar a sugestão;
  - baixar e conferir o histórico;
  - faltar saldo;
  - desfazer com devolução;
  - "Material pendente" depois do "Agora não".

## Pontos de atenção

- A ficha grava tratamentos direto pelo navegador, com RLS. Por isso o gatilho bloqueia mudanças manuais de `material_status`, e só as funções podem alterá-lo.
- `inventory_exit` continua a mesma. A baixa por kit só a reaproveita, então as regras da fase 1 valem sem duplicar código: o lote que vence antes sai primeiro, Uso pula lote vencido e produto inativo é recusado.
- A IA e a aprovação de orçamento podem concluir tratamentos. O gatilho garante que eles também ficam pendentes.
