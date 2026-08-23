# RecurringBillingApi.CreditCardDataAllOf

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**accountNumber** | **String** | Credit card number | [optional] 
**expirationDate** | **String** | Credit card’s expiration date in YYMM format | [optional] 
**CVV** | **String** | Credit card’s CVV2 number | [optional] 
**firstName** | **String** | The cardholder&#39;s first name | [optional] 
**lastName** | **String** | The cardholder&#39;s last name | [optional] 
**postalCode** | **String** | The cardholder&#39;s zip code. This field is not required. The PostalCode and StreetAddress fields are part of credit card address verification. These values will be validated against the value recorded at the issuing bank for the account when doing a credit card authorization. The response for this verification is found in the AVSResult field | [optional] 
**streetAddress** | **String** | The cardholder&#39;s street address. The StreetAddress and PostalCode fields are part of credit card address verification. These values will be validated against the value recorded at the issuing bank for the account when doing a credit card authorization. The response for this verification is found in the AVSResult field | [optional] 


