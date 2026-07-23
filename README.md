# Genesis · ZOE Performance Dashboard

Dashboard estática de performance que cruza dados de Meta Ads e ClickBank.

## Atribuição

- `utm_campaign` → `Campaign ID`
- `utm_medium` → `Ad Set ID`
- `utm_content` → `Ad ID`
- Upsells herdam os IDs do `upsellOriginalReceipt`.
- Os IDs são usados como chaves; a interface exibe os nomes recuperados do relatório do Meta Ads.

## Privacidade

O site não baixa nem publica a planilha bruta de compradores. `scripts/build-data.ps1`
gera apenas dados sanitizados e agregados em `data.json`; e-mails e o campo
`json_completo` não são incluídos.

## Atualizar os dados

No PowerShell:

```powershell
pwsh -File scripts/build-data.ps1
```

O script:

1. baixa os CSVs públicos das duas planilhas;
2. restringe o período à janela existente na base de vendas;
3. atribui vendas e receita pelos três IDs;
4. converte faturamento para USD;
5. grava `data.json` para o GitHub Pages e `public/data.json` para o build Vite.

As taxas de câmbio utilizadas estão registradas em `data.json` e usam como
referência as taxas do BCE de 22 de julho de 2026.

## Publicação

O build de produção gera um worker leve em `dist/server/index.js`. O mesmo
repositório também pode ser publicado diretamente no GitHub Pages a partir da
raiz.

