@IsTest(SeeAllData=true)
private class ClauseLibraryResolverTest {

    private static Map<String, Object> line(
        String sellingModel,
        String paymentTerm,
        String productId,
        String quoteLineItemId
    ) {
        Map<String, Object> m = new Map<String, Object>();

        if (sellingModel != null) {
            m.put('SellingModel__c', sellingModel);
        }

        if (paymentTerm != null) {
            m.put('PaymentTerm__c', paymentTerm);
        }

        if (productId != null) {
            m.put('Product', productId);
        }

        if (quoteLineItemId != null) {
            m.put('QuoteLineId', quoteLineItemId);
        }

        return m;
    }

    @IsTest
    static void testResolveAll_paymentAndWarrantyBranches() {

        Id industrialProductId = [
            SELECT Id
            FROM Product2
            WHERE Name = 'Apex IndustrialDrive 6000'
            LIMIT 1
        ].Id;

        Id softwareProductId = [
            SELECT Id
            FROM Product2
            WHERE Name LIKE 'Apex Connect Monitoring%'
            LIMIT 1
        ].Id;

        Id serviceProductId = [
            SELECT Id
            FROM Product2
            WHERE Family = 'Service'
            LIMIT 1
        ].Id;

        Id egyptAccountId = [
            SELECT Id
            FROM Account
            WHERE Region__c = 'Egypt'
            LIMIT 1
        ].Id;

        List<Object> lineRecords = new List<Object>{
            line(
                'OneTime',
                null,
                String.valueOf(industrialProductId),
                null
            ),
            line(
                'Evergreen',
                'Monthly',
                String.valueOf(softwareProductId),
                null
            ),
            line(
                'Evergreen',
                'Annual',
                String.valueOf(serviceProductId),
                null
            ),
            line(
                'TermDefined',
                'Monthly',
                null,
                null
            ),
            line(
                'TermDefined',
                'Annual',
                null,
                null
            )
        };

        Test.startTest();

        Map<String, String> tokens =
            ClauseLibraryResolver.resolveAll(
                lineRecords,
                String.valueOf(egyptAccountId)
            );

        Test.stopTest();

        System.assertNotEquals(null, tokens);

        System.assert(
            String.isNotBlank(
                tokens.get('PaymentTermsClauseText')
            )
        );

        System.assert(
            String.isNotBlank(
                tokens.get('ProductWarrantyClauseText')
            )
        );

        System.assert(
            String.isNotBlank(
                tokens.get('RegionalSupplementClauseText')
            )
        );
    }

    @IsTest
    static void testResolveAll_attributeDrivenClauses() {

        QuoteLineItemAttribute slaAttr = [
            SELECT QuoteLineItemId
            FROM QuoteLineItemAttribute
            WHERE AttributeName = 'SLA Level'
            LIMIT 1
        ];

        Id usaAccountId = [
            SELECT Id
            FROM Account
            WHERE Region__c = 'USA'
            LIMIT 1
        ].Id;

        List<Object> lineRecords =
            new List<Object>{
                line(
                    null,
                    null,
                    null,
                    String.valueOf(
                        slaAttr.QuoteLineItemId
                    )
                )
            };

        Test.startTest();

        Map<String, String> tokens =
            ClauseLibraryResolver.resolveAll(
                lineRecords,
                String.valueOf(usaAccountId)
            );

        Test.stopTest();

        System.assertNotEquals(
            null,
            tokens.get('SlaCommitmentClauseText')
        );
    }

    @IsTest
    static void testResolveAll_regionCases() {

        Id egyptAccountId = [
            SELECT Id
            FROM Account
            WHERE Region__c = 'Egypt'
            LIMIT 1
        ].Id;

        Test.startTest();

        Map<String,String> tokensEgypt =
            ClauseLibraryResolver.resolveAll(
                new List<Object>(),
                String.valueOf(egyptAccountId)
            );

        Map<String,String> tokensBlank =
            ClauseLibraryResolver.resolveAll(
                new List<Object>(),
                null
            );

        Map<String,String> tokensInvalid =
            ClauseLibraryResolver.resolveAll(
                new List<Object>(),
                'not-a-valid-id'
            );

        Test.stopTest();

        System.assert(
            String.isNotBlank(
                tokensEgypt.get(
                    'RegionalSupplementClauseText'
                )
            )
        );

        System.assertEquals(
            '',
            tokensBlank.get(
                'RegionalSupplementClauseText'
            )
        );

        System.assertEquals(
            '',
            tokensInvalid.get(
                'RegionalSupplementClauseText'
            )
        );
    }

    @IsTest
    static void testResolveAll_wrappedTagValueAndAltKeys() {

        QuoteLineItemAttribute anyAttr = [
            SELECT QuoteLineItemId
            FROM QuoteLineItemAttribute
            LIMIT 1
        ];

        String qliIdStr =
            String.valueOf(
                anyAttr.QuoteLineItemId
            );

        Id usaAccountId = [
            SELECT Id
            FROM Account
            WHERE Region__c = 'USA'
            LIMIT 1
        ].Id;

        Map<String, Object> wrappedLine =
            new Map<String, Object>{
                'SellingModel__c' =>
                    new Map<String, Object>{
                        'tagValue' => 'OneTime'
                    },
                'QuoteLineItemId' =>
                    new Map<String, Object>{
                        'tagValue' => qliIdStr
                    }
            };

        Map<String, Object> altKeyLine =
            new Map<String, Object>{
                'QuoteLineId__c' => qliIdStr
            };

        Map<String, Object> altKeyLine2 =
            new Map<String, Object>{
                'QuoteLineItemId__c' => qliIdStr
            };

        Test.startTest();

        Map<String, String> tokens =
            ClauseLibraryResolver.resolveAll(
                new List<Object>{
                    wrappedLine,
                    altKeyLine,
                    altKeyLine2
                },
                String.valueOf(usaAccountId)
            );

        Test.stopTest();

        System.assertNotEquals(
            null,
            tokens
        );
    }
}