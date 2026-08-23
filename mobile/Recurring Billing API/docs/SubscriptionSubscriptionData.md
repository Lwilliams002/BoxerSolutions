# RecurringBillingApi.SubscriptionSubscriptionData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**amount** | **Number** | Positive dollar amount of funds to be charged every cycle (weekly, biweekly, monthly). Decimal point required | [optional] 
**frequency** | **String** | Weekly, biweekly, or monthly frequency | [optional] 
**failureOption** | **String** | The action to be performed after a failed transaction or the last failed retry.   - **Forward** - The current balance will be transferred onto the next cycle - **Skip** - The current cycle will be skipped and will resume after the single skipped cycle. The amount of the next payment will not be affected - **Pause** - The subscription will be paused indefinitely. No new charges will occur until the subscription is resumed. The amount of the next payment after the subscription resumes will not be affected  | [optional] 
**numberOfPayments** | **Number** | Number of cycles to be charged. If not provided, the subscription will never expire | [optional] 
**retries** | **Number** | The number of consecutive days to attempt a payment after a failure. One attempt will be made per day. If the payment still fails on the last attempt, the FailureOption will be enforced. If a value is not provided for Retries, it will be defaulted to 3 | [optional] [default to 3]
**description** | **String** | An optional description field | [optional] 



## Enum: FrequencyEnum


* `Weekly` (value: `"Weekly"`)

* `BiWeekly` (value: `"BiWeekly"`)

* `Monthly` (value: `"Monthly"`)





## Enum: FailureOptionEnum


* `Forward` (value: `"Forward"`)

* `Skip` (value: `"Skip"`)

* `Pause` (value: `"Pause"`)




