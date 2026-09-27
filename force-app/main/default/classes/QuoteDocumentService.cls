public with sharing class QuoteDocumentService {

    private static final String TEMPLATE_TITLE = 'Design';
    private static final String DOCUMENT_TITLE = 'Quote Details';

    /**
     * Generates documents for the supplied Quotes.
     */
    public static void generateDocuments(Set<Id> quoteIds) {

        if (quoteIds == null || quoteIds.isEmpty()) {
            return;
        }

        /*
         * Fetch the latest version of the Design template.
         */
        List<ContentVersion> templateVersions = [
            SELECT Id,
                   Title,
                   ContentDocumentId,
                   VersionNumber,
                   IsLatest
            FROM ContentVersion
            WHERE ContentDocument.Title = :TEMPLATE_TITLE
              AND IsLatest = true
            ORDER BY CreatedDate DESC
            LIMIT 1
        ];

        if (templateVersions.isEmpty()) {
            throw new QuoteDocumentServiceException(
                'No latest ContentVersion was found for the template named "' +
                TEMPLATE_TITLE +
                '".'
            );
        }

        Id templateContentVersionId = templateVersions[0].Id;

        List<Quote> quotes = [
            SELECT Id,
                   Name
            FROM Quote
            WHERE Id IN :quoteIds
        ];

        List<DocumentGenerationProcess> generationProcesses =
            new List<DocumentGenerationProcess>();

        for (Quote quoteRecord : quotes) {

            Map<String, Object> tokenMap =
                buildTokenMap(quoteRecord.Id);

            DocumentGenerationProcess documentGeneration =
                new DocumentGenerationProcess();

            documentGeneration.Type = 'GenerateAndConvert';
            documentGeneration.DocGenApiVersionType = 'Advanced';

            documentGeneration.RequestText = JSON.serialize(
                new Map<String, Object>{
                    'keepIntermediate' => false,
                    'title' => DOCUMENT_TITLE,
                    'templateContentVersionId' =>
                        templateContentVersionId
                }
            );

            documentGeneration.ReferenceObject =
                quoteRecord.Id;

            documentGeneration.TokenData =
                JSON.serialize(tokenMap);

            generationProcesses.add(documentGeneration);
        }

        if (!generationProcesses.isEmpty()) {
            insert generationProcesses;
        }
    }

    /**
     * Builds all Quote and Quote Line Item tokens.
     */
    public static Map<String, Object> buildTokenMap(Id quoteId) {

        if (quoteId == null) {
            throw new QuoteDocumentServiceException(
                'A Quote Id is required to build the token map.'
            );
        }

        Map<String, Object> tokenMap =
            new Map<String, Object>();

        Quote quoteRecord = [
            SELECT Id,
                   QuoteNumber,
                   Name,
                   AccountId,
                   Account.Name,
                   CurrencyIsoCode,
                   Subtotal,
                   Discount,
                   TotalPrice
            FROM Quote
            WHERE Id = :quoteId
            LIMIT 1
        ];

        String currencyCode =
            quoteRecord.CurrencyIsoCode;

        /*
         * Quote header tokens.
         */
        tokenMap.put(
            'QuoteNumber',
            quoteRecord.QuoteNumber
        );

        tokenMap.put(
            'QuoteName',
            quoteRecord.Name
        );

        tokenMap.put(
            'AccountName',
            quoteRecord.Account != null
                ? quoteRecord.Account.Name
                : ''
        );

        tokenMap.put(
            'Currency',
            currencyCode
        );

        tokenMap.put(
            'CurrencyIsoCode',
            currencyCode
        );

        /*
         * Formatted monetary tokens.
         */
        tokenMap.put(
            'SubTotal',
            formatCurrency(
                quoteRecord.Subtotal,
                currencyCode
            )
        );

        String DiscountString = quoteRecord.Discount + ' %'; 
        tokenMap.put(
            'Discount',DiscountString);

        tokenMap.put(
            'Total',
            formatCurrency(
                quoteRecord.TotalPrice,
                currencyCode
            )
        );

        /*
         * Optional raw Decimal tokens.
         *
         * These can be useful if another consumer needs the amounts
         * without the appended ISO currency code.
         */
        tokenMap.put(
            'SubTotalRaw',
            quoteRecord.Subtotal
        );

        tokenMap.put(
            'DiscountRaw',
            quoteRecord.Discount
        );

        tokenMap.put(
            'TotalRaw',
            quoteRecord.TotalPrice
        );

        tokenMap.put(
            'TodayDate',
            formatDate(Date.today())
        );

        Map<String, RampGroupWrapper> rampGroupsByKey =
            new Map<String, RampGroupWrapper>();

        List<String> rampGroupOrder =
            new List<String>();

        List<QuoteLineItem> quoteLines = [
            SELECT Id,
                   QuoteId,
                   QuoteLineGroupId,
                   QuoteLineGroup.Name,
                   Product2Id,
                   Product2.Name,
                   Quantity,
                   ListPrice,
                   UnitPrice,
                   NetTotalPrice,
                   NetUnitPrice,
                   StartDate,
                   EndDate,
                   CreatedDate
            FROM QuoteLineItem
            WHERE QuoteId = :quoteId
            ORDER BY QuoteLineGroupId,
                     StartDate,
                     CreatedDate
        ];

        for (QuoteLineItem line : quoteLines) {

            String groupKey;
            String groupName;

            if (line.QuoteLineGroupId != null) {

                groupKey =
                    String.valueOf(line.QuoteLineGroupId);

                groupName =
                    line.QuoteLineGroup != null
                        ? line.QuoteLineGroup.Name
                        : 'Ramp Group';

            } else {

                groupKey = 'UNGROUPED';
                groupName = 'One-Time Products';
            }

            if (!rampGroupsByKey.containsKey(groupKey)) {

                RampGroupWrapper newGroup =
                    new RampGroupWrapper();

                newGroup.groupId =
                    line.QuoteLineGroupId;

                newGroup.groupName =
                    groupName;

                newGroup.startDate =
                    line.StartDate;

                newGroup.endDate =
                    line.EndDate;

                newGroup.groupTotal = 0;

                newGroup.products =
                    new List<Map<String, Object>>();

                rampGroupsByKey.put(
                    groupKey,
                    newGroup
                );

                rampGroupOrder.add(groupKey);
            }

            RampGroupWrapper currentGroup =
                rampGroupsByKey.get(groupKey);

            /*
             * Determine the earliest start date.
             */
            if (
                line.StartDate != null &&
                (
                    currentGroup.startDate == null ||
                    line.StartDate < currentGroup.startDate
                )
            ) {
                currentGroup.startDate =
                    line.StartDate;
            }

            /*
             * Determine the latest end date.
             */
            if (
                line.EndDate != null &&
                (
                    currentGroup.endDate == null ||
                    line.EndDate > currentGroup.endDate
                )
            ) {
                currentGroup.endDate =
                    line.EndDate;
            }

            /*
             * Keep the ramp total as a Decimal while calculating it.
             */
            if (line.NetTotalPrice != null) {
                currentGroup.groupTotal +=
                    line.NetTotalPrice;
            }

            Map<String, Object> productRow =
                buildProductRow(
                    line,
                    currencyCode
                );

            currentGroup.products.add(productRow);
        }

        /*
         * Convert the wrappers into DocGen-compatible nested maps.
         */
        List<Map<String, Object>> rampGroups =
            new List<Map<String, Object>>();

        Integer rampSequence = 1;

        for (String groupKey : rampGroupOrder) {

            RampGroupWrapper groupWrapper =
                rampGroupsByKey.get(groupKey);

            Map<String, Object> rampGroup =
                new Map<String, Object>();

            rampGroup.put(
                'RampGroupId',
                groupWrapper.groupId
            );

            rampGroup.put(
                'RampGroupName',
                groupWrapper.groupName
            );

            rampGroup.put(
                'RampSequence',
                rampSequence
            );

            rampGroup.put(
                'RampStartDate',
                formatDate(groupWrapper.startDate)
            );

            rampGroup.put(
                'RampEndDate',
                formatDate(groupWrapper.endDate)
            );

            rampGroup.put(
                'RampPeriod',
                buildRampPeriod(
                    groupWrapper.startDate,
                    groupWrapper.endDate
                )
            );

            rampGroup.put(
                'ProductCount',
                groupWrapper.products.size()
            );

            rampGroup.put(
                'Products',
                groupWrapper.products
            );

            /*
             * Formatted value displayed in the document.
             */
            rampGroup.put(
                'RampGroupTotal',
                formatCurrency(
                    groupWrapper.groupTotal,
                    currencyCode
                )
            );

            /*
             * Optional raw Decimal value.
             */
            rampGroup.put(
                'RampGroupTotalRaw',
                groupWrapper.groupTotal
            );

            rampGroup.put(
                'Currency',
                currencyCode
            );

            rampGroups.add(rampGroup);

            rampSequence++;
        }

        /*
         * Main nested collection used by the document template.
         */
        tokenMap.put(
            'RampGroups',
            rampGroups
        );

        tokenMap.put(
            'RampGroupCount',
            rampGroups.size()
        );

        tokenMap.put(
            'HasRampGroups',
            !rampGroups.isEmpty()
        );

        return tokenMap;
    }

    /**
     * Converts a Quote Line Item into a product row.
     */
    private static Map<String, Object> buildProductRow(
        QuoteLineItem line,
        String currencyCode
    ) {
        Map<String, Object> productRow =
            new Map<String, Object>();

        productRow.put(
            'QuoteLineItemId',
            line.Id
        );

        productRow.put(
            'ProductId',
            line.Product2Id
        );

        productRow.put(
            'ProductDescription',
            line.Product2 != null
                ? line.Product2.Name
                : ''
        );

        productRow.put(
            'ProductQuantity',
            line.Quantity
        );

        productRow.put(
            'Currency',
            currencyCode
        );

        productRow.put(
            'CurrencyIsoCode',
            currencyCode
        );

        /*
         * List price from QuoteLineItem.ListPrice.
         */
        productRow.put(
            'ProductListPrice',
            formatCurrency(
                line.ListPrice,
                currencyCode
            )
        );

        /*
         * Net unit price after pricing and discounts.
         */
        productRow.put(
            'ProductPrice',
            formatCurrency(
                line.NetUnitPrice,
                currencyCode
            )
        );

        productRow.put(
            'ProductNetUnitPrice',
            formatCurrency(
                line.NetUnitPrice,
                currencyCode
            )
        );

        productRow.put(
            'ProductTotal',
            formatCurrency(
                line.NetTotalPrice,
                currencyCode
            )
        );

        /*
         * Optional raw Decimal values.
         */
        productRow.put(
            'ProductListPriceRaw',
            line.ListPrice
        );

        productRow.put(
            'ProductPriceRaw',
            line.NetUnitPrice
        );

        productRow.put(
            'ProductTotalRaw',
            line.NetTotalPrice
        );

        productRow.put(
            'ProductStartDate',
            formatDate(line.StartDate)
        );

        productRow.put(
            'ProductEndDate',
            formatDate(line.EndDate)
        );

        return productRow;
    }

    /**
     * Formats a monetary value and appends the Quote's ISO currency.
     *
     * Examples:
     * 1,250.00 USD
     * 950.50 EUR
     */
    private static String formatCurrency(
        Decimal amount,
        String currencyCode
    ) {
        if (amount == null) {
            return '';
        }

        String formattedAmount =
            amount.setScale(2).format();

        if (String.isBlank(currencyCode)) {
            return formattedAmount;
        }

        return formattedAmount +
            ' ' +
            currencyCode;
    }

    /**
     * Produces a readable ramp period.
     *
     * Example:
     * 09/22/2026 - 09/21/2027
     */
    private static String buildRampPeriod(
        Date startDate,
        Date endDate
    ) {
        if (
            startDate == null &&
            endDate == null
        ) {
            return '';
        }

        if (startDate == null) {
            return formatDate(endDate);
        }

        if (endDate == null) {
            return formatDate(startDate);
        }

        return formatDate(startDate) +
            ' - ' +
            formatDate(endDate);
    }

    /**
     * Formats a Date for the document.
     */
    private static String formatDate(Date value) {

        if (value == null) {
            return '';
        }

        return value.format();
    }

    /**
     * Internal wrapper used while assembling the token map.
     */
    private class RampGroupWrapper {

        private Id groupId;
        private String groupName;
        private Date startDate;
        private Date endDate;
        private Decimal groupTotal;

        private List<Map<String, Object>> products;
    }

    /**
     * Service-specific exception.
     */
    public class QuoteDocumentServiceException
        extends Exception {
    }
}