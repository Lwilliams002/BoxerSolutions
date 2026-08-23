# RecurringBillingApi.InlineResponse2005Bills

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **Number** | ID number | [optional] 
**dueDate** | **String** | The date that the next bill is due | [optional] 
**paid** | **Boolean** | A boolean value indicating whether the bill has been paid | [optional] 
**amount** | **Number** | Positive dollar amount of funds to be charged every cycle (weekly, biweekly, monthly). Decimal point required | [optional] 
**status** | **String** | Subscription Status can be Active, Paused, or Expired | [optional] 
**active** | **Boolean** | Indicates whether the subscription is Active | [optional] 
**createdAt** | **String** | Timestamp when the subscription was created | [optional] 
**updatedAt** | **String** | Timestamp when the subscription was last updated | [optional] 
**subscriptionId** | **Number** | Subscription ID number | [optional] 
**payments** | [**[InlineResponse2005Payments]**](InlineResponse2005Payments.md) | Array of payment data | [optional] 
**customer** | [**InlineResponse2005Customer**](InlineResponse2005Customer.md) |  | [optional] 
**paymentMethod** | [**InlineResponse2005PaymentMethod**](InlineResponse2005PaymentMethod.md) |  | [optional] 



## Enum: PaidEnum


* `true` (value: `"true"`)

* `false` (value: `"false"`)





## Enum: StatusEnum


* `Active` (value: `"Active"`)

* `Paused` (value: `"Paused"`)

* `Expired` (value: `"Expired"`)

* `Canceled` (value: `"Canceled"`)




