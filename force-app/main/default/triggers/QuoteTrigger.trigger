trigger QuoteTrigger on Quote (after update) {
    QuoteTriggerHandler.afterUpdate(Trigger.new, Trigger.oldMap);
}