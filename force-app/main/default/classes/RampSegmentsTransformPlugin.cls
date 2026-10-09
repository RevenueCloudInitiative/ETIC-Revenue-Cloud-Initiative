global class RampSegmentsTransformPlugin
    implements ind_docgen_api.OpenInterface {

    private static final String RAMP_FIELD =
        '__Quote:QuoteLineItem__RampSegment__c__CTXTAG';

    private static final String RAMP_FIELD_SIMPLE =
        'RampSegment__c';

    private static final String NON_RAMPED_GROUP =
        'Non-Ramped Products';

    global Boolean invokeMethod(
        String methodName,
        Map<String, Object> inputMap,
        Map<String, Object> outputMap
    ) {
        if (String.isBlank(methodName)) {
            return false;
        }

        switch on methodName {
            when 'transformTokenData' {
                return transformTokenData(inputMap, outputMap);
            }
            when else {
                System.debug(
                    LoggingLevel.WARN,
                    'RampSegmentsTransformPlugin: Unsupported method: '
                    + methodName
                );
                return false;
            }
        }
    }

    private static Boolean transformTokenData(
        Map<String, Object> inputParameters,
        Map<String, Object> outputParameters
    ) {
        try {
            if (
                inputParameters == null ||
                inputParameters.get('TokenData') == null
            ) {
                System.debug(
                    LoggingLevel.ERROR,
                    'RampSegmentsTransformPlugin: TokenData is missing.'
                );
                return false;
            }

            String tokenDataJson =
                String.valueOf(inputParameters.get('TokenData'));

            if (String.isBlank(tokenDataJson)) {
                System.debug(
                    LoggingLevel.ERROR,
                    'RampSegmentsTransformPlugin: TokenData is empty.'
                );
                return false;
            }

            System.debug(
                LoggingLevel.DEBUG,
                'RampSegmentsTransformPlugin INPUT = '
                + tokenDataJson
            );

            Map<String, Object> source =
                (Map<String, Object>) JSON.deserializeUntyped(
                    tokenDataJson
                );

            /*
             * Preserve the original root-level TokenData.
             */
            Map<String, Object> result =
                new Map<String, Object>();

            for (String rootKey : source.keySet()) {
                result.put(
                    rootKey,
                    source.get(rootKey)
                );
            }

            /*
             * Normalize Contract header records.
             */
            List<Object> contractRecords =
                normalizeNodeList(
                    source.get('ContractCache')
                );

            if (!contractRecords.isEmpty()) {
                result.put(
                    'ContractCache',
                    contractRecords
                );
            }

            /*
             * Normalize Contract line records.
             */
            List<Object> lineRecords =
                normalizeNodeList(
                    source.get('SalesContractLineCache')
                );

            result.put(
                'SalesContractLineCache',
                lineRecords
            );

            /*
             * Group Contract lines by ramp segment.
             */
            Map<String, List<Object>> linesByRamp =
                new Map<String, List<Object>>();

            List<String> rampOrder =
                new List<String>();

            for (Object lineObject : lineRecords) {
                if (
                    !(lineObject
                        instanceof Map<String, Object>)
                ) {
                    continue;
                }

                Map<String, Object> line =
                    (Map<String, Object>) lineObject;

                /*
                 * Try the friendly Context attribute first.
                 */
                String rampName =
                    readString(
                        line,
                        RAMP_FIELD_SIMPLE
                    );

                /*
                 * Otherwise try the generated Context Service tag.
                 */
                if (String.isBlank(rampName)) {
                    rampName =
                        readString(
                            line,
                            RAMP_FIELD
                        );
                }

                /*
                 * A blank Ramp Segment means this is a normal,
                 * non-ramped product.
                 */
                if (String.isBlank(rampName)) {
                    rampName =
                        NON_RAMPED_GROUP;
                }

                /*
                 * Add a clean RampSegment token for Word.
                 */
                line.put(
                    'RampSegment',
                    rampName
                );

                if (
                    !linesByRamp.containsKey(
                        rampName
                    )
                ) {
                    linesByRamp.put(
                        rampName,
                        new List<Object>()
                    );

                    rampOrder.add(
                        rampName
                    );
                }

                linesByRamp
                    .get(rampName)
                    .add(line);

                System.debug(
                    LoggingLevel.DEBUG,
                    'Ramp assignment: '
                    + readString(line, 'Name')
                    + ' -> '
                    + rampName
                );
            }

            /*
             * Alphabetically order ramp groups first.
             */
            rampOrder.sort();

            /*
             * Move Non-Ramped Products to the beginning.
             */
            Integer nonRampedIndex =
                rampOrder.indexOf(
                    NON_RAMPED_GROUP
                );

            if (nonRampedIndex >= 0) {
                rampOrder.remove(
                    nonRampedIndex
                );

                rampOrder.add(
                    0,
                    NON_RAMPED_GROUP
                );
            }

            /*
             * Build dynamic RampGroups collection:
             *
             * RampGroups
             *   -> RampName
             *   -> Items
             */
            List<Object> rampGroups =
                new List<Object>();

            for (String rampName : rampOrder) {
                List<Object> items =
                    linesByRamp.get(
                        rampName
                    );

                Map<String, Object> rampGroup =
                    new Map<String, Object>();

                rampGroup.put(
                    'RampName',
                    rampName
                );

                rampGroup.put(
                    'Items',
                    items
                );

                rampGroup.put(
                    'ItemCount',
                    items.size()
                );

                rampGroup.put(
                    'HasItems',
                    !items.isEmpty()
                );

                rampGroups.add(
                    rampGroup
                );
            }

            result.put(
                'RampGroups',
                rampGroups
            );

            result.put(
                'HasRampGroups',
                !rampGroups.isEmpty()
            );

            /*
             * Optional static collections.
             */
            result.put(
                'NonRampedProducts',
                getGroupItems(
                    linesByRamp,
                    NON_RAMPED_GROUP
                )
            );

            result.put(
                'RampGroup',
                getGroupItems(
                    linesByRamp,
                    'Ramp Group'
                )
            );

            result.put(
                'RampGroupYear2',
                getGroupItems(
                    linesByRamp,
                    'Ramp Group - Year 2'
                )
            );

            result.put(
                'RampGroupYear3',
                getGroupItems(
                    linesByRamp,
                    'Ramp Group - Year 3'
                )
            );

            /*
             * Return transformed TokenData to DocGen.
             */
            String finalJson =
                JSON.serialize(result);

            System.debug(
                LoggingLevel.DEBUG,
                'RampSegmentsTransformPlugin OUTPUT = '
                + finalJson
            );

            outputParameters.put(
                'TokenData',
                finalJson
            );

            return true;

        } catch (Exception ex) {
            System.debug(
                LoggingLevel.ERROR,
                'RampSegmentsTransformPlugin failed: '
                + ex.getMessage()
                + '\n'
                + ex.getStackTraceString()
            );

            return false;
        }
    }

    /*
     * Normalize a Context Service node into an array of
     * template-friendly records.
     */
    private static List<Object> normalizeNodeList(
        Object nodeValue
    ) {
        List<Object> normalized =
            new List<Object>();

        if (nodeValue == null) {
            return normalized;
        }

        if (nodeValue instanceof List<Object>) {
            for (
                Object recordObject :
                (List<Object>) nodeValue
            ) {
                Object normalizedRecord =
                    normalizeRecord(
                        recordObject
                    );

                if (normalizedRecord != null) {
                    normalized.add(
                        normalizedRecord
                    );
                }
            }

            return normalized;
        }

        if (
            nodeValue
                instanceof Map<String, Object>
        ) {
            Object normalizedRecord =
                normalizeRecord(
                    nodeValue
                );

            if (normalizedRecord != null) {
                normalized.add(
                    normalizedRecord
                );
            }
        }

        return normalized;
    }

    /*
     * Supports both:
     *
     * {
     *     "Name": "Product A"
     * }
     *
     * and the wrapped Context Service debug representation:
     *
     * {
     *     "tagValue": {
     *         "Name": {
     *             "tagValue": "Product A"
     *         }
     *     }
     * }
     */
    private static Object normalizeRecord(
        Object recordObject
    ) {
        if (
            !(recordObject
                instanceof Map<String, Object>)
        ) {
            return recordObject;
        }

        Map<String, Object> rawRecord =
            (Map<String, Object>) recordObject;

        Object tagContainer =
            rawRecord.get(
                'tagValue'
            );

        if (
            tagContainer
                instanceof Map<String, Object>
        ) {
            Map<String, Object> wrappedFields =
                (Map<String, Object>) tagContainer;

            Map<String, Object> flattened =
                new Map<String, Object>();

            for (
                String fieldName :
                wrappedFields.keySet()
            ) {
                flattened.put(
                    fieldName,
                    unwrapValue(
                        wrappedFields.get(
                            fieldName
                        )
                    )
                );
            }

            if (
                rawRecord.containsKey(
                    'dataPath'
                )
            ) {
                flattened.put(
                    '_dataPath',
                    rawRecord.get(
                        'dataPath'
                    )
                );
            }

            if (
                rawRecord.containsKey(
                    'eTag'
                )
            ) {
                flattened.put(
                    '_eTag',
                    rawRecord.get(
                        'eTag'
                    )
                );
            }

            return flattened;
        }

        /*
         * TokenData is already flattened.
         * Return a copy so helper tokens can safely be added.
         */
        Map<String, Object> copiedRecord =
            new Map<String, Object>();

        for (
            String key :
                rawRecord.keySet()
        ) {
            copiedRecord.put(
                key,
                rawRecord.get(key)
            );
        }

        return copiedRecord;
    }

    /*
     * Extract an actual field value from the verbose
     * Context Service wrapper.
     */
    private static Object unwrapValue(
        Object valueObject
    ) {
        if (
            !(valueObject
                instanceof Map<String, Object>)
        ) {
            return valueObject;
        }

        Map<String, Object> wrapper =
            (Map<String, Object>) valueObject;

        if (
            wrapper.containsKey(
                'tagValue'
            )
        ) {
            return wrapper.get(
                'tagValue'
            );
        }

        /*
         * Context attribute exists but doesn't contain
         * a populated value.
         */
        if (
            wrapper.containsKey(
                'dmlStatus'
            ) ||
            wrapper.containsKey(
                'contextDataPathBuilder'
            ) ||
            wrapper.containsKey(
                'tagPath'
            )
        ) {
            return null;
        }

        return valueObject;
    }

    /*
     * Safely get a String from either flattened or wrapped data.
     */
    private static String readString(
        Map<String, Object> record,
        String fieldName
    ) {
        if (
            record == null ||
            String.isBlank(fieldName) ||
            !record.containsKey(
                fieldName
            )
        ) {
            return null;
        }

        Object rawValue =
            record.get(
                fieldName
            );

        if (rawValue == null) {
            return null;
        }

        if (
            !(rawValue
                instanceof Map<String, Object>)
        ) {
            return String.valueOf(
                rawValue
            );
        }

        Map<String, Object> wrapper =
            (Map<String, Object>) rawValue;

        if (
            wrapper.containsKey(
                'tagValue'
            ) &&
            wrapper.get(
                'tagValue'
            ) != null
        ) {
            return String.valueOf(
                wrapper.get(
                    'tagValue'
                )
            );
        }

        return null;
    }

    /*
     * Return lines for one fixed ramp group.
     */
    private static List<Object> getGroupItems(
        Map<String, List<Object>> linesByRamp,
        String rampName
    ) {
        if (
            linesByRamp != null &&
            linesByRamp.containsKey(
                rampName
            )
        ) {
            return linesByRamp.get(
                rampName
            );
        }

        return new List<Object>();
    }
}