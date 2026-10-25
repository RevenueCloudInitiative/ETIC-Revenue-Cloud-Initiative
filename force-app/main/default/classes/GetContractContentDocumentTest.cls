@IsTest
private class GetContractContentDocumentTest {

    @IsTest
    static void testNullRequestList() {

        Test.startTest();

        List<GetContractContentDocument.Response> responses =
            GetContractContentDocument.getContentDocument(null);

        Test.stopTest();

        System.assertEquals(
            0,
            responses.size(),
            'Null request list should return an empty response list.'
        );
    }


    @IsTest
    static void testEmptyRequestList() {

        List<GetContractContentDocument.Request> requests =
            new List<GetContractContentDocument.Request>();

        Test.startTest();

        List<GetContractContentDocument.Response> responses =
            GetContractContentDocument.getContentDocument(requests);

        Test.stopTest();

        System.assertEquals(
            0,
            responses.size(),
            'Empty request list should return an empty response list.'
        );
    }


    @IsTest
    static void testNullContractDocumentVersionId() {

        GetContractContentDocument.Request request =
            new GetContractContentDocument.Request();

        request.contractDocumentVersionId = null;

        List<GetContractContentDocument.Request> requests =
            new List<GetContractContentDocument.Request>{
                request
            };

        Test.startTest();

        List<GetContractContentDocument.Response> responses =
            GetContractContentDocument.getContentDocument(requests);

        Test.stopTest();

        System.assertEquals(
            1,
            responses.size()
        );

        System.assertEquals(
            false,
            responses[0].success
        );

        System.assertEquals(
            null,
            responses[0].contentDocumentId
        );

        System.assertEquals(
            'Contract Document Version Id was not provided.',
            responses[0].message
        );
    }


    @IsTest
    static void testNoContentDocumentFound() {

        /*
         * Generate a syntactically valid
         * ContractDocumentVersion Id.
         *
         * No actual database record is required because
         * the production class only uses the Id as a
         * SOQL filter.
         */
        String prefix =
            ContractDocumentVersion.SObjectType
                .getDescribe()
                .getKeyPrefix();

        Id fakeVersionId =
            Id.valueOf(
                prefix + '000000000000'
            );

        GetContractContentDocument.Request request =
            new GetContractContentDocument.Request();

        request.contractDocumentVersionId =
            fakeVersionId;

        List<GetContractContentDocument.Request> requests =
            new List<GetContractContentDocument.Request>{
                request
            };

        Test.startTest();

        List<GetContractContentDocument.Response> responses =
            GetContractContentDocument.getContentDocument(requests);

        Test.stopTest();

        System.assertEquals(
            1,
            responses.size()
        );

        System.assertEquals(
            false,
            responses[0].success
        );

        System.assertEquals(
            null,
            responses[0].contentDocumentId
        );

        System.assertEquals(
            'No Content Document was found for the Contract Document Version.',
            responses[0].message
        );
    }


    @IsTest
    static void testBulkRequestsWithNullIds() {

        GetContractContentDocument.Request request1 =
            new GetContractContentDocument.Request();

        GetContractContentDocument.Request request2 =
            new GetContractContentDocument.Request();

        List<GetContractContentDocument.Request> requests =
            new List<GetContractContentDocument.Request>{
                request1,
                request2
            };

        Test.startTest();

        List<GetContractContentDocument.Response> responses =
            GetContractContentDocument.getContentDocument(requests);

        Test.stopTest();

        System.assertEquals(
            2,
            responses.size()
        );

        System.assertEquals(
            false,
            responses[0].success
        );

        System.assertEquals(
            false,
            responses[1].success
        );
    }
}