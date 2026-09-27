public class QuoteTriggerHandler {

    public static void afterUpdate(
        List<Quote> newQuotes,
        Map<Id, Quote> oldMap
    ) {
        Set<Id> approvedQuoteIds = new Set<Id>();

        for (Quote quote : newQuotes) {

            Quote oldQuote = oldMap.get(quote.Id);

            if (
                quote.Status == 'Approved' &&
                oldQuote.Status != 'Approved'
            ) {
                approvedQuoteIds.add(quote.Id);
            }
        }

        if (!approvedQuoteIds.isEmpty()) {
            QuoteDocumentService.generateDocuments(approvedQuoteIds);
        }
    }
}