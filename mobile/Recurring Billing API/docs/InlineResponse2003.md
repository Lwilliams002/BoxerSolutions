# RecurringBillingApi.InlineResponse2003

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**_date** | **String** | The date of a transaction | 
**GUID** | **String** | Token/unique transaction ID generated for each financial transaction | 
**amount** | **Number** | Positive dollar amount of funds to be charged. Decimal point required | 
**code** | **String** | Contains the Response Code for the transaction requested and should be used to determine the result of the transaction. This information is passed from the issuing bank. The code 00 is returned on Approval, and most other codes indicate a Decline or Error. Please view a full list of Response Codes | 
**text** | **String** | Contains additional information for the transaction requested. This information can change at any time and should not be used in code to validate the response of a transaction (except for a limited case with Account Updater, for MasterCard only). The field is used to provide more information about the transaction when there is a decline, or a transaction with insufficient information to process | 
**approval** | **String** | Contains the approval code for the transaction requested. In the event that there is no approval, this field will be empty. Some issuers will return an authorization code on declined transactions. Use the AUTH_RESP value to determine if a transaction was approved | [optional] 
**successful** | **Boolean** | Indicates whether the transaction was successful or not | 


