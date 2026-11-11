## Para que serve

Controla os materiais da clínica: quanto há de cada produto, os lotes e validades, o que entrou e saiu, e o que precisa ser comprado. Com os kits, a baixa do material sai junto com o tratamento concluído.

## Cadastrar um produto

1. No menu, clique em **Estoque** e depois em **Novo produto**.
2. Preencha **Nome**, **Categoria**, **Unidade** (un, cx, ml...), **Fornecedor**, **Estoque mínimo** e **Estoque ideal**.
3. Informe o **Saldo inicial** e, se o produto tem validade, o **Lote** e a **Validade**.
4. Clique em **Salvar**.

![Produtos do estoque](/ajuda/img/estoque-produtos.png)

No alto da lista, os avisos mostram quantos produtos estão abaixo do mínimo, quantos lotes vencem em 30 dias e quantos já venceram. Clique num aviso para filtrar a lista.

## Registrar uma entrada (compra)

1. Na linha do produto, clique em **Entrada**.
2. Escolha o **Tipo** (Compra, Devolução ou Ajuste) e a **Quantidade**. Para produtos com validade, informe **Lote** e **Validade**.
3. Se informar o **Valor total (R$)**, a compra vira uma despesa no [Financeiro](#financeiro): paga (com data e forma de pagamento) ou a pagar (com vencimento).
4. Clique em **Confirmar**.

![Entrada de material](/ajuda/img/estoque-entrada.png)

## Registrar uma saída

1. Clique em **Saída** na linha do produto.
2. Informe a **Quantidade** e o **Motivo** (Uso, Perda ou Vencido).
3. O sistema tira primeiro do lote que vence antes (**Automático (vence primeiro)**), sem usar lotes vencidos. Para escolher, use **Sair de um lote específico**.
4. Clique em **Confirmar**.

## Contagem

Para acertar o sistema com o que há na prateleira, use **Contagem** no menu da linha, informe a **Quantidade contada** de cada lote e confirme. A diferença vira um ajuste.

## Kits de procedimento

Um kit é a lista de materiais usados num procedimento (ex.: Kit restauração: 1 resina, 1 ácido, 1 par de luvas).

1. Abra a aba **Kits** e clique em **Novo kit**.
2. Dê um **Nome** e adicione os **Produtos do kit** com as quantidades.
3. Clique em **Salvar**.

Quando um tratamento é concluído, o sistema pergunta se quer dar baixa no material: escolha o **Kit** (ou produtos avulsos) e clique em **Dar baixa**, ou **Não usar material**.

![Kits de procedimento](/ajuda/img/estoque-kits.png)

## Histórico e lista de compras

- A aba **Histórico** mostra todas as **Entradas e saídas**, com filtro por produto e tipo.
- **Lista de compras** reúne o que está abaixo do mínimo, com a quantidade para chegar ao estoque ideal. Dá para **Copiar texto** (para mandar ao fornecedor) ou **Imprimir**.

![Lista de compras](/ajuda/img/estoque-compras.png)
