public class ClauseLibraryResolver {

    private static final String SELLING_MODEL_FIELD = 'SellingModel__c';
    private static final String TERM_UNIT_FIELD = 'PaymentTerm__c';
    private static final String PRODUCT_FIELD = 'Product';

    public static Map<String, String> resolveAll(List<Object> lineRecords, String accountIdStr) {
        Map<String, String> tokens = new Map<String, String>();

        tokens.put(
            'PaymentTermsClauseText',
            resolvePaymentTerms(lineRecords)
        );

        tokens.put(
            'LiabilityClauseText',
            resolveSingleClause('Standard Liability Terms')
        );

        tokens.put(
            'ConfidentialityClauseText',
            resolveSingleClause('Standard Confidentiality Terms')
        );

        Map<Id, Map<String, String>> attributesByLine =
            getAttributesByQuoteLineItem(lineRecords);

        tokens.put(
            'SlaCommitmentClauseText',
            resolveAttributeDrivenClause(
                lineRecords,
                attributesByLine,
                'SLA Level',
                new Map<String, String>{
                    'Bronze' => 'SLA Commitment Terms - Bronze',
                    'Silver' => 'SLA Commitment Terms - Silver',
                    'Gold'   => 'SLA Commitment Terms - Gold'
                }
            )
        );

        tokens.put(
            'ResponseTimeClauseText',
            resolveAttributeDrivenClause(
                lineRecords,
                attributesByLine,
                'Response Time',
                new Map<String, String>{
                    '72hr' => 'Response Time Terms - 72hr',
                    '24hr' => 'Response Time Terms - 24hr',
                    '4hr'  => 'Response Time Terms - 4hr'
                }
            )
        );

        tokens.put(
            'DataHandlingClauseText',
            resolveAttributeDrivenClause(
                lineRecords,
                attributesByLine,
                'Deployment Type',
                new Map<String, String>{
                    'Cloud'      => 'Data Handling Terms - Cloud',
                    'On-Premise' => 'Data Handling Terms - On-Premise'
                }
            )
        );

        tokens.put(
            'ProductWarrantyClauseText',
            resolveProductWarranty(lineRecords)
        );
        tokens.put('RegionalSupplementClauseText', resolveRegionalSupplement(accountIdStr));

        return tokens;
    }

    private static String resolveSingleClause(String clauseSetName) {
        List<DocumentClause> clauses = [
            SELECT Content
            FROM DocumentClause
            WHERE DocumentClauseSet.Name = :clauseSetName
            AND Status = 'Active'
            AND IsAlternateClause = false
            LIMIT 1
        ];

        return clauses.isEmpty() ? '' : clauses[0].Content;
    }

    private static String resolvePaymentTerms(List<Object> lineRecords) {
        Set<String> clauseNamesNeeded = new Set<String>();

        for (Object lineObject : lineRecords) {
            if (!(lineObject instanceof Map<String, Object>)) {
                continue;
            }

            Map<String, Object> line =
                (Map<String, Object>) lineObject;

            String sellingModel =
                readString(line, SELLING_MODEL_FIELD);

            String termUnit =
                readString(line, TERM_UNIT_FIELD);

            String clauseName =
                resolvePaymentTermsClauseName(sellingModel, termUnit);

            if (String.isNotBlank(clauseName)) {
                clauseNamesNeeded.add(clauseName);
            }
        }

        return fetchAndJoinClauses(clauseNamesNeeded);
    }

    private static String resolvePaymentTermsClauseName(
        String sellingModel,
        String termUnit
    ) {
        if (sellingModel == 'OneTime') {
            return 'Payment Terms - One Time';
        }
        if (sellingModel == 'Evergreen') {
            if (termUnit == 'Monthly') return 'Payment Terms - Evergreen Monthly';
            if (termUnit == 'Annual') return 'Payment Terms - Evergreen Yearly';
        }
        if (sellingModel == 'TermDefined') {
            if (termUnit == 'Monthly') return 'Payment Terms - Term Based Monthly';
            if (termUnit == 'Annual') return 'Payment Terms - Term Based Yearly';
        }
        return null;
    }

    private static String resolveAttributeDrivenClause(
        List<Object> lineRecords,
        Map<Id, Map<String, String>> attributesByLine,
        String attributeName,
        Map<String, String> clauseNameByAttributeValue
    ) {
        Set<String> clauseNamesNeeded = new Set<String>();

        for (Object lineObject : lineRecords) {
            if (!(lineObject instanceof Map<String, Object>)) {
                continue;
            }

            Map<String, Object> line =
                (Map<String, Object>) lineObject;

            String lineIdStr = getQuoteLineItemIdFromLine(line);

            if (String.isBlank(lineIdStr)) {
                continue;
            }

            Id lineId;
            try {
                lineId = Id.valueOf(lineIdStr);
            } catch (Exception ex) {
                continue;
            }

            Map<String, String> lineAttributes =
                attributesByLine.get(lineId);

            if (lineAttributes == null) {
                continue;
            }

            String attributeValue = lineAttributes.get(attributeName);

            System.debug(
                LoggingLevel.DEBUG,
                'Attribute lookup: ' + attributeName
                + '=' + attributeValue
                + ' on line ' + lineId
            );

            if (
                attributeValue != null &&
                clauseNameByAttributeValue.containsKey(attributeValue)
            ) {
                clauseNamesNeeded.add(
                    clauseNameByAttributeValue.get(attributeValue)
                );
            }
        }

        return fetchAndJoinClauses(clauseNamesNeeded);
    }

    private static String resolveProductWarranty(List<Object> lineRecords) {
        Set<Id> productIds = new Set<Id>();

        for (Object lineObject : lineRecords) {
            if (!(lineObject instanceof Map<String, Object>)) {
                continue;
            }

            Map<String, Object> line =
                (Map<String, Object>) lineObject;

            String productIdStr = readString(line, PRODUCT_FIELD);

            if (String.isNotBlank(productIdStr)) {
                try {
                    productIds.add(Id.valueOf(productIdStr));
                } catch (Exception ex) {}
            }
        }

        if (productIds.isEmpty()) {
            return '';
        }

        Map<Id, String> familyByProductId = new Map<Id, String>();
        for (Product2 p : [SELECT Id, Family FROM Product2 WHERE Id IN :productIds]) {
            familyByProductId.put(p.Id, p.Family);
        }

        Set<String> clauseNamesNeeded = new Set<String>();

        for (Id productId : familyByProductId.keySet()) {
            String clauseName = resolveWarrantyClauseName(familyByProductId.get(productId));
            if (clauseName != null) {
                clauseNamesNeeded.add(clauseName);
            }
        }

        return fetchAndJoinClauses(clauseNamesNeeded);
    }

    private static String resolveWarrantyClauseName(String family) {
        if (family == null) return null;
        if (family == 'Industrial Equipment') return 'Product Warranty Terms - Industrial Equipment';
        if (family.contains('Software')) return 'Product Warranty Terms - Software';
        if (family == 'Service') return 'Product Warranty Terms - Service';
        return null;
    }

    /*
     * Tries every known possible key name for the Quote Line Item
     * Id, since the Context Mapping's real output key has been
     * unreliable to confirm from the UI alone.
     */
    private static String getQuoteLineItemIdFromLine(Map<String, Object> line) {
        List<String> candidateKeys = new List<String>{
            'QuoteLineId', 'QuoteLineItemId', 'QuoteLineId__c', 'QuoteLineItemId__c'
        };

        for (String key : candidateKeys) {
            String val = readString(line, key);
            if (String.isNotBlank(val)) {
                return val;
            }
        }

        return null;
    }
    private static String resolveRegionalSupplement(String accountIdStr) {
        if (String.isBlank(accountIdStr)) {
            return '';
        }

        Id accountId;
        try {
            accountId = Id.valueOf(accountIdStr);
        } catch (Exception ex) {
            return '';
        }

        List<Account> accounts = [
            SELECT Region__c FROM Account WHERE Id = :accountId LIMIT 1
        ];

        if (accounts.isEmpty()) {
            return '';
        }

        String region = accounts[0].Region__c;
        System.debug(LoggingLevel.DEBUG, 'Account Region = ' + region);

        String clauseName;
        if (region == 'Germany' || region == 'Netherlands') {
            clauseName = 'EU Data Protection Supplement';
        } else if (region == 'Egypt') {
            clauseName = 'Egypt Data Protection Supplement';
        } else if (region == 'USA') {
            clauseName = 'USA Data Protection Supplement';
        } else {
            return '';
        }

        List<DocumentClause> clauses = [
            SELECT Content
            FROM DocumentClause
            WHERE Name = :clauseName
            AND Status = 'Active'
            LIMIT 1
        ];

        if (clauses.isEmpty()) {
            return '';
        }

        return clauses[0].Content;
    }
    private static Map<Id, Map<String, String>> getAttributesByQuoteLineItem(
        List<Object> lineRecords
    ) {
        Set<Id> quoteLineItemIds = new Set<Id>();

        for (Object lineObject : lineRecords) {
            if (!(lineObject instanceof Map<String, Object>)) {
                continue;
            }

            Map<String, Object> line =
                (Map<String, Object>) lineObject;

            String lineIdStr = getQuoteLineItemIdFromLine(line);

            if (String.isNotBlank(lineIdStr)) {
                try {
                    quoteLineItemIds.add(Id.valueOf(lineIdStr));
                } catch (Exception ex) {}
            }
        }

        Map<Id, Map<String, String>> result = new Map<Id, Map<String, String>>();

        if (quoteLineItemIds.isEmpty()) {
            System.debug(
                LoggingLevel.WARN,
                'No valid QuoteLineItemIds found on contract lines, '
                + 'even after trying all candidate key names.'
            );
            return result;
        }

        List<QuoteLineItemAttribute> attrs = [
            SELECT QuoteLineItemId, AttributeName, AttributeValue
            FROM QuoteLineItemAttribute
            WHERE QuoteLineItemId IN :quoteLineItemIds
        ];

        for (QuoteLineItemAttribute attr : attrs) {
            if (!result.containsKey(attr.QuoteLineItemId)) {
                result.put(attr.QuoteLineItemId, new Map<String, String>());
            }
            result.get(attr.QuoteLineItemId).put(attr.AttributeName, attr.AttributeValue);
        }

        return result;
    }

    private static String fetchAndJoinClauses(Set<String> clauseNamesNeeded) {
        if (clauseNamesNeeded.isEmpty()) {
            return '';
        }

        Map<String, String> contentByClauseName = new Map<String, String>();

        List<DocumentClause> clauses = [
            SELECT Name, Content
            FROM DocumentClause
            WHERE Name IN :clauseNamesNeeded
            AND Status = 'Active'
        ];

        for (DocumentClause c : clauses) {
            contentByClauseName.put(c.Name, c.Content);
        }

        return String.join(new List<String>(contentByClauseName.values()), '\n\n');
    }

    private static String readString(Map<String, Object> record, String fieldName) {
        if (record == null || String.isBlank(fieldName) || !record.containsKey(fieldName)) {
            return null;
        }

        Object rawValue = record.get(fieldName);

        if (rawValue == null) {
            return null;
        }

        if (!(rawValue instanceof Map<String, Object>)) {
            return String.valueOf(rawValue);
        }

        Map<String, Object> wrapper = (Map<String, Object>) rawValue;

        if (wrapper.containsKey('tagValue') && wrapper.get('tagValue') != null) {
            return String.valueOf(wrapper.get('tagValue'));
        }

        return null;
    }
}