## Para que serve

O orçamento é criado na ficha do paciente e enviado por WhatsApp como um link. O paciente abre no celular, escolhe o que quer fazer e assina com o CPF. A tela **Orçamentos** acompanha todos eles como um funil: enviados, para ligar, aprovados e perdidos.

## Antes de começar

- Defina a validade padrão em [Dados da clínica](#clinica).
- Para enviar pelo WhatsApp, conecte o WhatsApp e ligue **Envio de orçamento** em [Mensagens automáticas](#config-mensagens). Sem isso, o link pode ser copiado e enviado à mão.

## Criar um orçamento

1. Na ficha do paciente, abra a aba **Orçamentos** e clique em **Novo orçamento**.
2. Para cada procedimento, preencha o nome, o **Dente** (se houver), a **Qtd** e o **Valor un. (R$)**.
3. Escreva **Observações** se quiser (ex.: condições de pagamento).
4. Clique em **Criar orçamento**. Ele fica como rascunho até ser enviado.

![Orçamentos na ficha do paciente](/ajuda/img/orcamentos-ficha.png)

## Enviar ao paciente

1. No orçamento, clique em **Enviar**. O paciente recebe o link no WhatsApp.
2. Se aparecer "Orçamento não enviado por WhatsApp. Copie o link e envie manualmente.", use **Copiar link** e mande pelo canal que preferir.
3. Para mandar de novo (ex.: o paciente perdeu a mensagem), use **Reenviar**.

Se você mudar um orçamento já enviado, o link antigo deixa de funcionar e é preciso enviar de novo.

## O que o paciente vê

Pelo link, o paciente vê os itens do tratamento e pode desmarcar o que não quer fazer agora. Para aprovar, informa o **Nome completo** e o **CPF**, marca "Li e concordo com os itens selecionados e com o valor total." e toca em **Assinar e aprovar**. Se não quiser seguir, toca em **Não quero seguir** e pode dizer o motivo.

Quando o paciente aprova, o sino de pendências e o menu **Orçamentos** avisam a recepção.

![Página do orçamento no celular do paciente](/ajuda/img/orcamentos-paciente.png)

## Aprovado ou perdido pela recepção

Se o paciente decidiu pessoalmente ou por telefone:

- **Aprovou**: marque os itens aprovados e confirme. Fica registrado como aprovado pela recepção, sem a assinatura do paciente.
- **Perdido**: escolha o motivo (preço, vai pensar, fechou em outro lugar etc.) e, se quiser, uma observação.

Um orçamento perdido ou aprovado pode voltar com **Reabrir**. No aprovado, **Gerar cobrança** abre a cobrança do valor aprovado (veja [Financeiro](#financeiro)), e **Comprovante** mostra o registro da assinatura. **Histórico** lista tudo o que aconteceu com o orçamento.

## Acompanhar o funil

1. No menu, clique em **Orçamentos**.
2. Escolha o período e o dentista (ou **Todos**).
3. Navegue pelas abas:
   - **Enviados**: aguardando resposta do paciente;
   - **Para ligar**: enviados há 7 dias ou mais, ou vistos pelo paciente há 2 dias ou mais, sem resposta;
   - **Aprovados** e **Perdidos**.

No alto, os indicadores mostram o valor **Apresentado**, o **Aprovado**, a taxa de aprovação, o tempo médio até aprovar, os **Motivos de perda** e os números **Por dentista**.

![Funil de orçamentos](/ajuda/img/orcamentos-funil.png)

## Registrar uma ligação

Na aba **Para ligar**, clique em **Registrar contato** depois de falar com o paciente e escolha o resultado:

- **Não atendeu (ligar amanhã)**: volta para a lista amanhã;
- **Vai pensar**: escolha a data para ligar de novo;
- **Aprovou por telefone**: abre a aprovação pela recepção;
- **Não vai fazer (perdido)**: abre a marcação de perdido.

![Registrar contato](/ajuda/img/orcamentos-contato.png)
