@IsTest
private class RampSegmentsTransformPluginTest {

    private static final String GENERATED_RAMP_FIELD =
        '__Quote:QuoteLineItem__RampSegment__c__CTXTAG';

    @IsTest
    static void transformTokenDataGroupsAndNormalizesLines() {
        /*
         * ContractCache is provided as a single wrapped record.
         * The plugin should normalize it into a List<Object>.
         */
        Map<String, Object> wrappedContract =
            createWrappedRecord(
                new Map<String, Object>{
                    'Name' => createTagValue('Test Contract'),
                    'ContractNumber' => createTagValue('C-00001')
                },
                'ContractCache:0',
                'contract-etag'
            );

        /*
         * First line is already flattened and has no Ramp Segment.
         * It should be assigned to Non-Ramped Products.
         */
        Map<String, Object> nonRampedLine =
            new Map<String, Object>{
                'Name' => 'Standard Product',
                'Quantity' => 1
            };

        /*
         * Second line is already flattened and uses the friendly
         * RampSegment__c field.
         */
        Map<String, Object> yearTwoLine =
            new Map<String, Object>{
                'Name' => 'Year Two Product',
                'RampSegment__c' => 'Ramp Group - Year 2',
                'Quantity' => 2
            };

        /*
         * Third line uses the generated Context Service field.
         */
        Map<String, Object> generatedFieldLine =
            new Map<String, Object>{
                'Name' => 'Base Ramp Product',
                GENERATED_RAMP_FIELD => createTagValue('Ramp Group'),
                'Quantity' => 3
            };

        /*
         * Fourth line is in the wrapped Context Service format.
         */
        Map<String, Object> wrappedYearThreeLine =
            createWrappedRecord(
                new Map<String, Object>{
                    'Name' => createTagValue('Year Three Product'),
                    'RampSegment__c' =>
                        createTagValue('Ramp Group - Year 3'),
                    'Quantity' => createTagValue(4),

                    /*
                     * A Context attribute wrapper without a tagValue
                     * should be flattened to null.
                     */
                    'UnusedAttribute' =>
                        new Map<String, Object>{
                            'dmlStatus' => 'UNCHANGED'
                        }
                },
                'SalesContractLineCache:3',
                'line-etag'
            );

        /*
         * This non-map value covers the branch where a list entry
         * cannot be grouped as a Contract Line record.
         */
        List<Object> salesContractLines =
            new List<Object>{
                nonRampedLine,
                yearTwoLine,
                generatedFieldLine,
                wrappedYearThreeLine,
                'Unexpected non-map line'
            };

        Map<String, Object> sourceTokenData =
            new Map<String, Object>{
                'ContractCache' => wrappedContract,
                'SalesContractLineCache' => salesContractLines,
                'ExistingRootToken' => 'Preserve this value'
            };

        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => JSON.serialize(sourceTokenData)
            };

        Map<String, Object> outputMap =
            new Map<String, Object>();

        RampSegmentsTransformPlugin plugin =
            new RampSegmentsTransformPlugin();

        Test.startTest();

        Boolean wasSuccessful =
            plugin.invokeMethod(
                'transformTokenData',
                inputMap,
                outputMap
            );

        Test.stopTest();

        System.assertEquals(
            true,
            wasSuccessful,
            'The transformation should complete successfully.'
        );

        System.assert(
            outputMap.containsKey('TokenData'),
            'The output should contain transformed TokenData.'
        );

        Map<String, Object> result =
            deserializeMap(
                String.valueOf(outputMap.get('TokenData'))
            );

        /*
         * Verify existing root values are preserved.
         */
        System.assertEquals(
            'Preserve this value',
            String.valueOf(result.get('ExistingRootToken')),
            'Existing root-level tokens should be preserved.'
        );

        /*
         * Verify ContractCache normalization.
         */
        List<Object> normalizedContracts =
            getObjectList(result, 'ContractCache');

        System.assertEquals(
            1,
            normalizedContracts.size(),
            'The single ContractCache record should become a list.'
        );

        Map<String, Object> normalizedContract =
            (Map<String, Object>) normalizedContracts[0];

        System.assertEquals(
            'Test Contract',
            String.valueOf(normalizedContract.get('Name'))
        );

        System.assertEquals(
            'C-00001',
            String.valueOf(normalizedContract.get('ContractNumber'))
        );

        System.assertEquals(
            'ContractCache:0',
            String.valueOf(normalizedContract.get('_dataPath'))
        );

        System.assertEquals(
            'contract-etag',
            String.valueOf(normalizedContract.get('_eTag'))
        );

        /*
         * Verify Contract Line normalization.
         *
         * All five values remain in SalesContractLineCache because
         * normalizeRecord returns non-map values unchanged.
         */
        List<Object> normalizedLines =
            getObjectList(
                result,
                'SalesContractLineCache'
            );

        System.assertEquals(
            5,
            normalizedLines.size(),
            'All normalized line values should remain in the line cache.'
        );

        /*
         * Only the four map-based records become grouped line items.
         */
        List<Object> rampGroups =
            getObjectList(result, 'RampGroups');

        System.assertEquals(
            4,
            rampGroups.size(),
            'Four distinct ramp groups should be generated.'
        );

        System.assertEquals(
            true,
            (Boolean) result.get('HasRampGroups'),
            'HasRampGroups should be true.'
        );

        /*
         * Non-Ramped Products should be moved to the beginning,
         * followed by the other groups alphabetically.
         */
        assertRampGroup(
            rampGroups,
            0,
            'Non-Ramped Products',
            1
        );

        assertRampGroup(
            rampGroups,
            1,
            'Ramp Group',
            1
        );

        assertRampGroup(
            rampGroups,
            2,
            'Ramp Group - Year 2',
            1
        );

        assertRampGroup(
            rampGroups,
            3,
            'Ramp Group - Year 3',
            1
        );

        /*
         * Verify the static convenience collections.
         */
        System.assertEquals(
            1,
            getObjectList(
                result,
                'NonRampedProducts'
            ).size()
        );

        System.assertEquals(
            1,
            getObjectList(
                result,
                'RampGroup'
            ).size()
        );

        System.assertEquals(
            1,
            getObjectList(
                result,
                'RampGroupYear2'
            ).size()
        );

        System.assertEquals(
            1,
            getObjectList(
                result,
                'RampGroupYear3'
            ).size()
        );

        /*
         * Check the clean RampSegment token added to each line.
         */
        Map<String, Object> nonRampedResult =
            getFirstMap(
                result,
                'NonRampedProducts'
            );

        System.assertEquals(
            'Non-Ramped Products',
            String.valueOf(
                nonRampedResult.get('RampSegment')
            )
        );

        Map<String, Object> baseRampResult =
            getFirstMap(
                result,
                'RampGroup'
            );

        System.assertEquals(
            'Ramp Group',
            String.valueOf(
                baseRampResult.get('RampSegment')
            )
        );

        Map<String, Object> yearTwoResult =
            getFirstMap(
                result,
                'RampGroupYear2'
            );

        System.assertEquals(
            'Ramp Group - Year 2',
            String.valueOf(
                yearTwoResult.get('RampSegment')
            )
        );

        Map<String, Object> yearThreeResult =
            getFirstMap(
                result,
                'RampGroupYear3'
            );

        System.assertEquals(
            'Ramp Group - Year 3',
            String.valueOf(
                yearThreeResult.get('RampSegment')
            )
        );

        /*
         * Verify wrapped line metadata and values were flattened.
         */
        System.assertEquals(
            'Year Three Product',
            String.valueOf(yearThreeResult.get('Name'))
        );

        System.assertEquals(
            'SalesContractLineCache:3',
            String.valueOf(yearThreeResult.get('_dataPath'))
        );

        System.assertEquals(
            'line-etag',
            String.valueOf(yearThreeResult.get('_eTag'))
        );

        System.assertEquals(
            null,
            yearThreeResult.get('UnusedAttribute'),
            'The empty Context attribute should normalize to null.'
        );

        /*
         * ClauseLibraryResolver is called by the plugin.
         * Without matching test clauses, these tokens should be empty.
         */
        System.assertEquals(
            '',
            String.valueOf(
                result.get('PaymentTermsClauseText')
            )
        );

        System.assertEquals(
            '',
            String.valueOf(
                result.get('RegionalSupplementClauseText')
            )
        );
    }

    @IsTest
    static void transformHandlesSingleFlattenedLineRecord() {
        /*
         * SalesContractLineCache is deliberately a single Map,
         * rather than a List. normalizeNodeList should convert it
         * into a one-item list.
         */
        Map<String, Object> singleLine =
            new Map<String, Object>{
                'Name' => 'Single Product',
                'RampSegment__c' => 'Ramp Group - Year 2'
            };

        Map<String, Object> sourceTokenData =
            new Map<String, Object>{
                'SalesContractLineCache' => singleLine
            };

        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => JSON.serialize(sourceTokenData)
            };

        Map<String, Object> outputMap =
            new Map<String, Object>();

        Test.startTest();

        Boolean wasSuccessful =
            new RampSegmentsTransformPlugin().invokeMethod(
                'transformTokenData',
                inputMap,
                outputMap
            );

        Test.stopTest();

        System.assertEquals(
            true,
            wasSuccessful
        );

        Map<String, Object> result =
            deserializeMap(
                String.valueOf(outputMap.get('TokenData'))
            );

        System.assertEquals(
            1,
            getObjectList(
                result,
                'SalesContractLineCache'
            ).size()
        );

        List<Object> rampGroups =
            getObjectList(result, 'RampGroups');

        System.assertEquals(
            1,
            rampGroups.size()
        );

        assertRampGroup(
            rampGroups,
            0,
            'Ramp Group - Year 2',
            1
        );

        System.assertEquals(
            true,
            (Boolean) result.get('HasRampGroups')
        );
    }

    @IsTest
    static void transformHandlesMissingLineAndContractNodes() {
        Map<String, Object> sourceTokenData =
            new Map<String, Object>{
                'ExistingValue' => 'Still here'
            };

        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => JSON.serialize(sourceTokenData)
            };

        Map<String, Object> outputMap =
            new Map<String, Object>();

        Test.startTest();

        Boolean wasSuccessful =
            new RampSegmentsTransformPlugin().invokeMethod(
                'transformTokenData',
                inputMap,
                outputMap
            );

        Test.stopTest();

        System.assertEquals(
            true,
            wasSuccessful,
            'Missing optional line and Contract nodes should not fail.'
        );

        Map<String, Object> result =
            deserializeMap(
                String.valueOf(outputMap.get('TokenData'))
            );

        System.assertEquals(
            'Still here',
            String.valueOf(result.get('ExistingValue'))
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'SalesContractLineCache'
            ).size()
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'RampGroups'
            ).size()
        );

        System.assertEquals(
            false,
            (Boolean) result.get('HasRampGroups')
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'NonRampedProducts'
            ).size()
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'RampGroup'
            ).size()
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'RampGroupYear2'
            ).size()
        );

        System.assertEquals(
            0,
            getObjectList(
                result,
                'RampGroupYear3'
            ).size()
        );
    }

    @IsTest
    static void invokeMethodRejectsBlankAndUnsupportedMethods() {
        RampSegmentsTransformPlugin plugin =
            new RampSegmentsTransformPlugin();

        System.assertEquals(
            false,
            plugin.invokeMethod(
                null,
                new Map<String, Object>(),
                new Map<String, Object>()
            ),
            'A null method name should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                '',
                new Map<String, Object>(),
                new Map<String, Object>()
            ),
            'A blank method name should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'unsupportedMethod',
                new Map<String, Object>(),
                new Map<String, Object>()
            ),
            'An unsupported method should return false.'
        );
    }

    @IsTest
    static void transformRejectsMissingTokenData() {
        RampSegmentsTransformPlugin plugin =
            new RampSegmentsTransformPlugin();

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'transformTokenData',
                null,
                new Map<String, Object>()
            ),
            'A null input map should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'transformTokenData',
                new Map<String, Object>(),
                new Map<String, Object>()
            ),
            'An input map without TokenData should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'transformTokenData',
                new Map<String, Object>{
                    'TokenData' => null
                },
                new Map<String, Object>()
            ),
            'A null TokenData value should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'transformTokenData',
                new Map<String, Object>{
                    'TokenData' => ''
                },
                new Map<String, Object>()
            ),
            'An empty TokenData value should return false.'
        );

        System.assertEquals(
            false,
            plugin.invokeMethod(
                'transformTokenData',
                new Map<String, Object>{
                    'TokenData' => '   '
                },
                new Map<String, Object>()
            ),
            'Whitespace-only TokenData should return false.'
        );
    }

    @IsTest
    static void transformHandlesInvalidJson() {
        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => '{ invalid json'
            };

        Map<String, Object> outputMap =
            new Map<String, Object>();

        Test.startTest();

        Boolean wasSuccessful =
            new RampSegmentsTransformPlugin().invokeMethod(
                'transformTokenData',
                inputMap,
                outputMap
            );

        Test.stopTest();

        System.assertEquals(
            false,
            wasSuccessful,
            'Malformed JSON should be caught and return false.'
        );

        System.assertEquals(
            false,
            outputMap.containsKey('TokenData'),
            'No transformed TokenData should be returned.'
        );
    }

    @IsTest
    static void transformHandlesNonObjectJsonRoot() {
        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => JSON.serialize(
                    new List<Object>{
                        'Item 1',
                        'Item 2'
                    }
                )
            };

        Test.startTest();

        Boolean wasSuccessful =
            new RampSegmentsTransformPlugin().invokeMethod(
                'transformTokenData',
                inputMap,
                new Map<String, Object>()
            );

        Test.stopTest();

        System.assertEquals(
            false,
            wasSuccessful,
            'A JSON array cannot be cast to the required root map.'
        );
    }

    @IsTest
    static void transformHandlesNullOutputMap() {
        Map<String, Object> sourceTokenData =
            new Map<String, Object>{
                'SalesContractLineCache' =>
                    new List<Object>()
            };

        Map<String, Object> inputMap =
            new Map<String, Object>{
                'TokenData' => JSON.serialize(sourceTokenData)
            };

        Test.startTest();

        Boolean wasSuccessful =
            new RampSegmentsTransformPlugin().invokeMethod(
                'transformTokenData',
                inputMap,
                null
            );

        Test.stopTest();

        System.assertEquals(
            false,
            wasSuccessful,
            'A null output map should be caught and return false.'
        );
    }

    private static Map<String, Object> createWrappedRecord(
        Map<String, Object> wrappedFields,
        String dataPath,
        String eTag
    ) {
        return new Map<String, Object>{
            'tagValue' => wrappedFields,
            'dataPath' => dataPath,
            'eTag' => eTag
        };
    }

    private static Map<String, Object> createTagValue(
        Object value
    ) {
        return new Map<String, Object>{
            'tagValue' => value
        };
    }

    private static Map<String, Object> deserializeMap(
        String jsonValue
    ) {
        return (Map<String, Object>)
            JSON.deserializeUntyped(jsonValue);
    }

    private static List<Object> getObjectList(
        Map<String, Object> source,
        String key
    ) {
        System.assert(
            source.containsKey(key),
            'Expected output key was not found: ' + key
        );

        return (List<Object>) source.get(key);
    }

    private static Map<String, Object> getFirstMap(
        Map<String, Object> source,
        String collectionName
    ) {
        List<Object> records =
            getObjectList(
                source,
                collectionName
            );

        System.assertEquals(
            1,
            records.size(),
            collectionName +
            ' should contain exactly one record.'
        );

        return (Map<String, Object>) records[0];
    }

    private static void assertRampGroup(
        List<Object> rampGroups,
        Integer position,
        String expectedRampName,
        Integer expectedItemCount
    ) {
        Map<String, Object> rampGroup =
            (Map<String, Object>)
                rampGroups[position];

        System.assertEquals(
            expectedRampName,
            String.valueOf(
                rampGroup.get('RampName')
            ),
            'Unexpected RampName at position ' +
            position + '.'
        );

        System.assertEquals(
            expectedItemCount,
            Integer.valueOf(
                String.valueOf(
                    rampGroup.get('ItemCount')
                )
            ),
            'Unexpected ItemCount for ' +
            expectedRampName + '.'
        );

        System.assertEquals(
            expectedItemCount > 0,
            (Boolean) rampGroup.get('HasItems'),
            'Unexpected HasItems value for ' +
            expectedRampName + '.'
        );

        List<Object> items =
            (List<Object>) rampGroup.get('Items');

        System.assertEquals(
            expectedItemCount,
            items.size(),
            'Unexpected Items size for ' +
            expectedRampName + '.'
        );
    }
}