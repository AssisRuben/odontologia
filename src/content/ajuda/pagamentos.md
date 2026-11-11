## Para que serve

Conectando a clínica ao **Asaas** (serviço de cobrança), o sistema gera boleto, Pix e link de pagamento para o paciente, acompanha o pagamento sozinho e pode emitir a nota fiscal de serviço. Sem essa conexão, o [Financeiro](#financeiro) funciona normalmente, com os pagamentos lançados à mão.

## Antes de começar

- Tenha uma conta no Asaas e copie a **chave de API** no painel do Asaas.
- Para emitir nota fiscal, a clínica precisa ter CNPJ e a nota fiscal configurada no próprio Asaas.

## Conectar o Asaas

1. Em **Configurações**, clique em **Pagamentos**.
2. Em **Ambiente**, escolha **Teste (sandbox)** para experimentar ou **Produção** para cobrar de verdade.
3. Cole a chave em **Chave de API** e clique em **Conectar Asaas**.

![Conexão com o Asaas](/ajuda/img/pagamentos-conexao.png)

## Multa, juros e nota fiscal

Depois de conectado, aparecem mais opções:

- **Multa e juros por atraso**: **Multa (%)** (de 0 a 2%) e **Juros ao mês (%)** (de 0 a 1%), aplicados às cobranças vencidas;
- **Nota fiscal (NFS-e)**: **Emitir automaticamente ao receber**, **Código do serviço**, **ISS (%)** e **Descrição padrão do serviço**.

Clique em **Salvar configurações**. Se a nota fiscal ainda não estiver configurada no Asaas, aparece o aviso "Falta configurar a nota fiscal no Asaas".

## Dúvidas comuns

**A chave parou de funcionar.** Aparece "A chave não é mais válida". Gere uma nova chave no Asaas e use **Trocar chave**.
