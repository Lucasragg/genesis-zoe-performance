$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$adsUrl = 'https://docs.google.com/spreadsheets/d/1kDLfvIz99iCIzGNznJfNzKrv1rKKdOVUvMfaP5bOvq0/gviz/tq?tqx=out:csv&sheet=P%C3%A1gina1'
$salesUrl = 'https://docs.google.com/spreadsheets/d/1asxYr4dGjz_P9TjDuk_79YAV-mXKBz_hfyp9nhb6xRg/gviz/tq?tqx=out:csv&sheet=clickbank_sales_rows'

# ECB reference rates for 2026-07-22. ECB quotes currency units per EUR.
$eurUsd = 1.1408
$fxToUsd = [ordered]@{
    USD = 1.0
    EUR = $eurUsd
    GBP = $eurUsd / 0.85340
    CAD = $eurUsd / 1.6071
    MXN = $eurUsd / 19.8767
}

function Convert-ToNumber {
    param([object]$Value)
    if ($null -eq $Value) { return 0.0 }
    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text) -or $text -eq 'null') { return 0.0 }
    if ($text.Contains(',')) {
        $text = $text.Replace('.', '').Replace(',', '.')
    }
    return [double]::Parse($text, [Globalization.CultureInfo]::InvariantCulture)
}

function Get-IdAfterPipe {
    param([object]$Value)
    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text) -or $text -eq 'empty') { return '' }
    $candidate = ($text -split '\|')[-1].Trim()
    if ($candidate -match '^\d+$') { return $candidate }
    return ''
}

function New-Rollup {
    param([string]$Id, [string]$Name)
    return [ordered]@{
        id = $Id
        name = $Name
        spend = 0.0
        impressions = 0
        clicks = 0
        landingPageViews = 0
        checkouts = 0
        sales = 0
        revenue = 0.0
    }
}

function Add-MediaMetrics {
    param([System.Collections.IDictionary]$Target, [object]$Row)
    $Target.spend += Convert-ToNumber $Row.'Amount Spent'
    $Target.impressions += [int](Convert-ToNumber $Row.Impressions)
    $Target.clicks += [int](Convert-ToNumber $Row.'Link Clicks')
    $Target.landingPageViews += [int](Convert-ToNumber $Row.'Landing Page Views')
    $Target.checkouts += [int](Convert-ToNumber $Row.'Checkouts Initiated')
}

function Add-SaleMetrics {
    param([System.Collections.IDictionary]$Target, [int]$Sales, [double]$Revenue)
    $Target.sales += $Sales
    $Target.revenue += $Revenue
}

Write-Host 'Downloading source spreadsheets...'
$adsCsv = (Invoke-WebRequest -Uri $adsUrl -UseBasicParsing -TimeoutSec 120).Content
$salesCsv = (Invoke-WebRequest -Uri $salesUrl -UseBasicParsing -TimeoutSec 120).Content
$adsRows = @($adsCsv | ConvertFrom-Csv)
$salesRows = @($salesCsv | ConvertFrom-Csv)

$saleDates = @($salesRows | ForEach-Object {
    if ($_.transaction_time) { ([string]$_.transaction_time).Substring(0, 10) }
} | Where-Object { $_ } | Sort-Object)

if ($saleDates.Count -eq 0) { throw 'No dated sales found.' }
$dateStart = $saleDates[0]
$dateEnd = $saleDates[-1]

$campaignNames = @{}
$adsetNames = @{}
$adNames = @{}
$campaigns = @{}
$adsets = @{}
$ads = @{}
$daily = @{}

foreach ($row in $adsRows) {
    $day = [string]$row.Day
    if ($day -lt $dateStart -or $day -gt $dateEnd) { continue }

    $campaignId = [string]$row.'Campaign ID'
    $adsetId = [string]$row.'Ad Set ID'
    $adId = [string]$row.'Ad ID'
    $campaignName = [string]$row.'Campaign Name'
    $adsetName = [string]$row.'Ad Set Name'
    $adName = [string]$row.'Ad Name'

    $campaignNames[$campaignId] = $campaignName
    $adsetNames[$adsetId] = $adsetName
    $adNames[$adId] = $adName

    if (-not $campaigns.ContainsKey($campaignId)) { $campaigns[$campaignId] = New-Rollup $campaignId $campaignName }
    if (-not $adsets.ContainsKey($adsetId)) {
        $adsets[$adsetId] = New-Rollup $adsetId $adsetName
        $adsets[$adsetId].campaignId = $campaignId
        $adsets[$adsetId].campaignName = $campaignName
    }
    if (-not $ads.ContainsKey($adId)) {
        $ads[$adId] = New-Rollup $adId $adName
        $ads[$adId].campaignId = $campaignId
        $ads[$adId].campaignName = $campaignName
        $ads[$adId].adsetId = $adsetId
        $ads[$adId].adsetName = $adsetName
    }
    if (-not $daily.ContainsKey($day)) {
        $daily[$day] = New-Rollup $day $day
        $daily[$day].date = $day
    }

    Add-MediaMetrics $campaigns[$campaignId] $row
    Add-MediaMetrics $adsets[$adsetId] $row
    Add-MediaMetrics $ads[$adId] $row
    Add-MediaMetrics $daily[$day] $row
}

$trackingByReceipt = @{}
foreach ($row in $salesRows) {
    $trackingByReceipt[[string]$row.receipt] = [ordered]@{
        campaignId = Get-IdAfterPipe $row.utm_campaign
        adsetId = Get-IdAfterPipe $row.utm_medium
        adId = Get-IdAfterPipe $row.utm_content
    }
}

$totalRevenueUsd = 0.0
$attributedRevenueUsd = 0.0
$totalTransactions = 0
$attributedTransactions = 0
$directTransactions = 0
$inheritedTransactions = 0
$totalSales = 0
$attributedSales = 0

foreach ($row in $salesRows) {
    $day = ([string]$row.transaction_time).Substring(0, 10)
    if ($day -lt $dateStart -or $day -gt $dateEnd) { continue }

    $totalTransactions++
    $itemNo = [string]$row.item_no
    $isFrontEndSale = $itemNo -in @('1', '2')
    if ($isFrontEndSale) { $totalSales++ }

    $currency = ([string]$row.currency).ToUpperInvariant()
    $rate = if ($fxToUsd.Contains($currency)) { [double]$fxToUsd[$currency] } else { 1.0 }
    $transactionType = ([string]$row.transaction_type).ToUpperInvariant()
    $sign = if ($transactionType -match 'REFUND|RFND|CHARGEBACK|CGBK') { -1.0 } else { 1.0 }
    $revenueUsd = (Convert-ToNumber $row.total_order_amount) * $rate * $sign
    $totalRevenueUsd += $revenueUsd

    $tracking = $trackingByReceipt[[string]$row.receipt]
    $hasDirect = $tracking.campaignId -and $tracking.adsetId -and $tracking.adId

    if (-not $hasDirect) {
        try {
            $json = ([string]$row.json_completo | ConvertFrom-Json)
            $originalReceipt = [string]$json.upsell.upsellOriginalReceipt
            if ($originalReceipt -and $trackingByReceipt.ContainsKey($originalReceipt)) {
                $tracking = $trackingByReceipt[$originalReceipt]
                $inheritedTransactions++
            }
        } catch {
            # Malformed tracking payloads remain unattributed.
        }
    } else {
        $directTransactions++
    }

    $isMatched = (
        $tracking.campaignId -and $campaignNames.ContainsKey($tracking.campaignId) -and
        $tracking.adsetId -and $adsetNames.ContainsKey($tracking.adsetId) -and
        $tracking.adId -and $adNames.ContainsKey($tracking.adId)
    )

    if (-not $isMatched) { continue }

    $attributedTransactions++
    $attributedRevenueUsd += $revenueUsd
    $saleCount = if ($isFrontEndSale) { 1 } else { 0 }
    $attributedSales += $saleCount

    if (-not $daily.ContainsKey($day)) {
        $daily[$day] = New-Rollup $day $day
        $daily[$day].date = $day
    }

    Add-SaleMetrics $campaigns[$tracking.campaignId] $saleCount $revenueUsd
    Add-SaleMetrics $adsets[$tracking.adsetId] $saleCount $revenueUsd
    Add-SaleMetrics $ads[$tracking.adId] $saleCount $revenueUsd
    Add-SaleMetrics $daily[$day] $saleCount $revenueUsd
}

$total = New-Rollup 'total' 'Total'
foreach ($row in $daily.Values) {
    $total.spend += $row.spend
    $total.impressions += $row.impressions
    $total.clicks += $row.clicks
    $total.landingPageViews += $row.landingPageViews
    $total.checkouts += $row.checkouts
    $total.sales += $row.sales
    $total.revenue += $row.revenue
}

$output = [ordered]@{
    metadata = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        periodStart = $dateStart
        periodEnd = $dateEnd
        currency = 'USD'
        revenueDefinition = 'Attributed ClickBank gross order amount converted to USD; frontend items 1/2 count as sales and upsells add revenue.'
        attribution = 'Exact Campaign ID + Ad Set ID + Ad ID. Upsells inherit the original receipt tracking.'
        fx = [ordered]@{
            source = 'ECB reference rates'
            referenceDate = '2026-07-22'
            sourceUrl = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'
            ratesToUsd = $fxToUsd
        }
        sourceSheets = @(
            [ordered]@{ name = 'Dados gerenciador - ZOE'; role = 'Meta Ads' },
            [ordered]@{ name = 'clickbank_sales_rows'; role = 'ClickBank sales' }
        )
    }
    coverage = [ordered]@{
        totalTransactions = $totalTransactions
        attributedTransactions = $attributedTransactions
        attributionRate = if ($totalTransactions) { $attributedTransactions / $totalTransactions } else { 0 }
        directTransactions = $directTransactions
        inheritedTransactions = $inheritedTransactions
        totalSales = $totalSales
        attributedSales = $attributedSales
        totalRevenueUsd = $totalRevenueUsd
        attributedRevenueUsd = $attributedRevenueUsd
    }
    totals = $total
    daily = @($daily.Values | Sort-Object { $_.date })
    campaigns = @($campaigns.Values | Sort-Object { $_.spend } -Descending)
    adsets = @($adsets.Values | Sort-Object { $_.spend } -Descending)
    ads = @($ads.Values | Sort-Object { $_.spend } -Descending)
}

$root = Split-Path -Parent $PSScriptRoot
$jsonPath = Join-Path $root 'data.json'
$output | ConvertTo-Json -Depth 10 -Compress | Set-Content -LiteralPath $jsonPath -Encoding UTF8
Write-Host "Wrote sanitized dashboard data to $jsonPath"
