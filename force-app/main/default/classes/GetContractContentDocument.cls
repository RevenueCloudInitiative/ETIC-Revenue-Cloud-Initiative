public with sharing class GetContractContentDocument {

    public class Request {

        @InvocableVariable(
            required=true
            label='Contract Document Version Id'
        )
        public Id contractDocumentVersionId;
    }


    public class Response {

        @InvocableVariable(
            label='Content Document Id'
        )
        public Id contentDocumentId;

        @InvocableVariable(
            label='Success'
        )
        public Boolean success;

        @InvocableVariable(
            label='Message'
        )
        public String message;
    }


    @InvocableMethod(
        label='Get PDF From Contract Document Version'
        description='Returns the PDF ContentDocumentId related to the provided ContractDocumentVersionId'
    )
    public static List<Response> getContentDocument(
        List<Request> requests
    ) {

        List<Response> responses = new List<Response>();

        if (requests == null || requests.isEmpty()) {
            return responses;
        }


        /*
         * 1. Collect ContractDocumentVersion IDs
         */
        Set<Id> versionIds = new Set<Id>();

        for (Request req : requests) {

            if (
                req != null &&
                req.contractDocumentVersionId != null
            ) {
                versionIds.add(
                    req.contractDocumentVersionId
                );
            }
        }


        /*
         * 2. Find ContentDocuments related to those
         *    ContractDocumentVersions.
         */
        Map<Id, Set<Id>> versionToContentDocuments =
            new Map<Id, Set<Id>>();

        Set<Id> allContentDocumentIds =
            new Set<Id>();

        if (!versionIds.isEmpty()) {

            List<ContractDocVerContentDoc> records = [
                SELECT
                    ContractDocumentVersionId,
                    ContentDocumentId
                FROM ContractDocVerContentDoc
                WHERE ContractDocumentVersionId IN :versionIds
                AND ContentDocumentId != null
            ];

            for (
                ContractDocVerContentDoc record : records
            ) {

                if (
                    !versionToContentDocuments.containsKey(
                        record.ContractDocumentVersionId
                    )
                ) {
                    versionToContentDocuments.put(
                        record.ContractDocumentVersionId,
                        new Set<Id>()
                    );
                }

                versionToContentDocuments
                    .get(record.ContractDocumentVersionId)
                    .add(record.ContentDocumentId);

                allContentDocumentIds.add(
                    record.ContentDocumentId
                );
            }
        }


        /*
         * 3. Find which ContentDocuments are PDFs.
         *
         * ContentVersion tells us the FileType.
         */
        Set<Id> pdfContentDocumentIds =
            new Set<Id>();

        if (!allContentDocumentIds.isEmpty()) {

            List<ContentVersion> pdfVersions = [
                SELECT
                    Id,
                    ContentDocumentId,
                    FileType,
                    Title,
                    FileExtension,
                    CreatedDate
                FROM ContentVersion
                WHERE ContentDocumentId IN :allContentDocumentIds
                AND IsLatest = true
                AND FileType = 'PDF'
                ORDER BY CreatedDate DESC
            ];

            for (ContentVersion pdfVersion : pdfVersions) {

                pdfContentDocumentIds.add(
                    pdfVersion.ContentDocumentId
                );
            }
        }


        /*
         * 4. Match the PDF back to each
         *    ContractDocumentVersion.
         */
        Map<Id, Id> versionToPdf =
            new Map<Id, Id>();

        for (Id versionId : versionToContentDocuments.keySet()) {

            Set<Id> documentIds =
                versionToContentDocuments.get(versionId);

            for (Id documentId : documentIds) {

                if (
                    pdfContentDocumentIds.contains(
                        documentId
                    )
                ) {
                    versionToPdf.put(
                        versionId,
                        documentId
                    );

                    break;
                }
            }
        }


        /*
         * 5. Build responses for Flow
         */
        for (Request req : requests) {

            Response response =
                new Response();

            response.success = false;

            if (
                req == null ||
                req.contractDocumentVersionId == null
            ) {

                response.message =
                    'Contract Document Version Id was not provided.';

            } else if (
                versionToPdf.containsKey(
                    req.contractDocumentVersionId
                )
            ) {

                response.contentDocumentId =
                    versionToPdf.get(
                        req.contractDocumentVersionId
                    );

                response.success = true;

                response.message =
                    'PDF Content Document found successfully.';

            } else {

                response.message =
                    'No PDF Content Document was found for the Contract Document Version.';
            }

            responses.add(response);
        }

        return responses;
    }
}