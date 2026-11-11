## Para que serve

O Financeiro mostra o dinheiro da clínica: o que entrou, o que vai entrar, as despesas, o saldo previsto para os próximos meses, a comissão dos dentistas e o livro-caixa para o imposto. Use as setas no alto para mudar o mês.

## Antes de começar

- Informe as [Taxas de cartão](#taxas), para o sistema calcular o valor líquido dos pagamentos.
- Para boleto, Pix e nota fiscal, conecte o [Asaas](#pagamentos).
- Para comissão, defina o percentual de cada dentista em [Profissionais](#profissionais).

## Painel

A aba **Painel** resume o mês escolhido:

- **Entradas**: **Recebido**, **A receber** e o total previsto;
- **Saídas**: **Pago**, **A pagar** e o total previsto;
- **Resultado**: o **Líquido realizado** até agora e a **Previsão** para o mês.

Abaixo ficam as **Próximas despesas** e os **Lançamentos do mês**.

Na lista de lançamentos, o menu de cada pagamento permite **Marcar como pago**, **Alterar vencimento**, **Copiar link** ou **Enviar link pelo WhatsApp** (cobranças do Asaas) e **Emitir nota** (nota fiscal).

![Painel do Financeiro](/ajuda/img/financeiro-painel.png)

## Lançar um recebimento ou cobrança

Recebimentos são lançados na ficha do paciente:

1. Abra a ficha, aba **Pagamentos**, e clique em **Nova cobrança**.
2. Informe o **Valor total (R$)** e a **Descrição**.
3. Escolha como cobrar:
   - **Registrar sem link**: lançamento manual, marcado como **Já recebido** (com a forma e a data do pagamento) ou **A receber** (com vencimento);
   - **À vista**, **Carnê** ou **Cartão parcelado**: o Asaas gera o boleto, Pix ou link de cartão e avisa quando o paciente paga.
4. Clique em **Registrar** (ou **Criar cobrança**).

Um orçamento aprovado também gera cobrança pelo botão **Gerar cobrança** (veja [Orçamentos](#orcamentos)).

![Nova cobrança](/ajuda/img/financeiro-cobranca.png)

## A receber

A aba **A receber** reúne as cobranças em aberto, agrupadas em **Em atraso**, **Vence nos próximos 7 dias** e **Depois**, com o **Total a receber**. Cada cobrança mostra o último lembrete enviado ao paciente. Use **Buscar paciente** e o filtro de **Tipo** (Boleto/carnê, Pix/link, Cartão parcelado, Lançamento manual) para achar uma cobrança.

![Cobranças a receber](/ajuda/img/financeiro-receber.png)

## Despesas

1. Abra a aba **Despesas** e clique em **Nova despesa**.
2. Preencha **Descrição**, **Valor (R$)**, **Categoria** e o **Vencimento**.
3. Se já pagou, marque **Já foi paga** e informe a **Data do pagamento** e a **Forma de pagamento**. Anexe o **Comprovante** se quiser.
4. Para contas fixas (aluguel, internet), deixe **Já foi paga** desmarcado e marque **Repete todo mês**, com o **Dia do vencimento** e, se houver, **Até (opcional)**. O sistema cria as próximas contas "a pagar" sozinho.
5. Se a despesa é de um dentista (ex.: laboratório), escolha o **Dentista (opcional)**: ela é descontada da comissão dele.
6. Clique em **Salvar**.

Na lista, use **Marcar como paga** quando pagar uma conta. As despesas recorrentes têm um ícone próprio e a opção **Encerrar recorrência**.

![Despesas do mês](/ajuda/img/financeiro-despesas.png)

## Fluxo de caixa

A aba **Fluxo de caixa** mostra o saldo previsto mês a mês, a partir do saldo da conta da clínica.

1. Clique em **Informar saldo** e informe o **Saldo no fim do dia (R$)** de uma data (ontem, por exemplo).
2. O gráfico e a tabela mostram, para cada mês, **Saldo inicial**, **Entradas**, **Saídas** e **Saldo final**, e o **Menor saldo previsto** do período.
3. Clique num mês para ver o dia a dia.

Cobranças e contas atrasadas não entram no saldo previsto, porque não se sabe quando serão pagas.

![Fluxo de caixa](/ajuda/img/financeiro-fluxo.png)

## Comissões

A aba **Comissões** mostra, por dentista, a comissão do mês sobre o que foi **recebido** (particular e convênio separados), menos os descontos de laboratório.

1. Clique em **Ver extrato** para conferir cada recebimento que entrou na conta.
2. No fim do mês, clique em **Fechar mês**. O valor fica congelado, mesmo que o percentual mude depois.
3. Quando pagar o dentista, use **Marcar como pago**, com a data e a forma de pagamento. O pagamento vira uma despesa.

Se precisar corrigir, use **Reabrir** (mês fechado) ou **Desfazer pagamento**.

![Comissões do mês](/ajuda/img/financeiro-comissoes.png)

## Livro-caixa e Carnê-Leão

A aba **Livro-caixa** monta o **Resultado do mês** para o Carnê-Leão: receitas, despesas dedutíveis e o resultado.

- Em **Recibos do Receita Saúde**, cada pagamento de paciente aparece com o CPF e o valor. Use **Copiar CPF** e **Copiar valor** para emitir o recibo no aplicativo Receita Saúde e depois **Marcar como emitido**.
- **Baixar pacote do contador** gera um arquivo com o livro-caixa do mês e os comprovantes das despesas, para mandar ao contador.

![Livro-caixa](/ajuda/img/financeiro-livro.png)
