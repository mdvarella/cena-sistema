# PENDÊNCIA — e-mail DocuSign DEMO (NOR-ATEST-CENA v2)

Registrada em 27/09/2026. **Não invalida** a homologação técnica ponta a ponta.

## Fato

O envelope DEMO foi criado sem falha e concluído pela interface DocuSign:

- documento `f9986b99-0382-40c4-9fc1-3a5b2d7172d6`
- envelope local `f0766c08-d7fd-4cde-9664-1cfd27bbf72f`
- provider `0dca2d4d-9570-828d-8094-7f50a2981b00`
- destinatário de homologação `marcos@cenabr.com.br`

A notificação por e-mail **não apareceu** na caixa postal, embora o fluxo Connect/webhook tenha recebido `envelope-completed` e a finalização automática tenha arquivado no Dossiê.

## Escopo

Investigar **antes** de ativar PRODUÇÃO:

- entrega/spam/filtros da conta DEMO;
- configuração de notificação do envelope vs. acesso direto à interface;
- se o mesmo sintoma ocorre em conta de produção.

Não alterar secrets, banco, webhook ou ambiente nesta nota.
