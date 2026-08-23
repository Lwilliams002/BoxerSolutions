# RecurringBillingApi.CreateAndManageSubscriptionsApi

All URIs are relative to *https://billing.epxuap.com*

Method | HTTP request | Description
------------- | ------------- | -------------
[**cancelSubscription**](CreateAndManageSubscriptionsApi.md#cancelSubscription) | **POST** /subscription/cancel | Cancel Subscription
[**chargePaymentMethod**](CreateAndManageSubscriptionsApi.md#chargePaymentMethod) | **POST** /chargepaymentmethod | One-Time Payment
[**createSubscription**](CreateAndManageSubscriptionsApi.md#createSubscription) | **POST** /subscription | Create Subscription
[**getSubscriptionById**](CreateAndManageSubscriptionsApi.md#getSubscriptionById) | **POST** /subscription/list | Lookup Subscription
[**pauseResume**](CreateAndManageSubscriptionsApi.md#pauseResume) | **POST** /subscription/pause | Pause/Resume Subscription
[**payBill**](CreateAndManageSubscriptionsApi.md#payBill) | **POST** /paybill | Pay Subscription Bill
[**updateSubscription**](CreateAndManageSubscriptionsApi.md#updateSubscription) | **PUT** /subscription | Update Subscription



## cancelSubscription

> InlineResponse2004 cancelSubscription(ePIId, ePISignature, opts)

Cancel Subscription

Cancel a subscription indefinitely. There is no option to restore a canceled subscription. When a subscription is canceled, no more bills will be generated even if the cancellation happens in the middle of a cycle. If you would like to charge one final bill or prorate the amount of the final bill, the One-Time Payment endpoint may be used to process a standalone payment.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject4': new RecurringBillingApi.InlineObject4() // InlineObject4 | 
};
apiInstance.cancelSubscription(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject4** | [**InlineObject4**](InlineObject4.md)|  | [optional] 

### Return type

[**InlineResponse2004**](InlineResponse2004.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## chargePaymentMethod

> InlineResponse2003 chargePaymentMethod(ePIId, ePISignature, opts)

One-Time Payment

Manually process a single transaction independently from a subscription. Using this endpoint will not count toward a subscription payment.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject3': new RecurringBillingApi.InlineObject3() // InlineObject3 | 
};
apiInstance.chargePaymentMethod(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject3** | [**InlineObject3**](InlineObject3.md)|  | [optional] 

### Return type

[**InlineResponse2003**](InlineResponse2003.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## createSubscription

> InlineResponse2001 createSubscription(ePIId, ePISignature, opts)

Create Subscription

Create a weekly, biweekly, or monthly subscription with a fixed payment amount. If the frequency is set to Monthly, the BillingDate will determine which day of the month the subsequent charges will occur. Weekly and biweekly charges will occur on the same day of the week as the initial payment

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject1': new RecurringBillingApi.InlineObject1() // InlineObject1 | 
};
apiInstance.createSubscription(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject1** | [**InlineObject1**](InlineObject1.md)|  | [optional] 

### Return type

[**InlineResponse2001**](InlineResponse2001.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## getSubscriptionById

> InlineResponse2005 getSubscriptionById(ePIId, ePISignature, opts)

Lookup Subscription

Retrieve subscription data including all bills using the Subscription ID.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject5': new RecurringBillingApi.InlineObject5() // InlineObject5 | 
};
apiInstance.getSubscriptionById(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject5** | [**InlineObject5**](InlineObject5.md)|  | [optional] 

### Return type

[**InlineResponse2005**](InlineResponse2005.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## pauseResume

> InlineResponse2006 pauseResume(ePIId, ePISignature, opts)

Pause/Resume Subscription

Either pause an active subscription by passing the boolean value true in the Paused field, which prevents any new payments from being charged, or resume a subscription by passing the boolean value false in the Paused field and recalculate the billing date for the end of the next cycle. When a subscription is paused, no new charges will occur until the subscription is resumed. The amount of the next payment after the subscription resumes will not be changed.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject6': new RecurringBillingApi.InlineObject6() // InlineObject6 | 
};
apiInstance.pauseResume(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject6** | [**InlineObject6**](InlineObject6.md)|  | [optional] 

### Return type

[**InlineResponse2006**](InlineResponse2006.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## payBill

> InlineResponse2002 payBill(ePIId, ePISignature, opts)

Pay Subscription Bill

Manually pay a bill that&#39;s part of a subscription prior to the due date or past the due date if the automatic payment fails. Using this endpoint to pay a bill will count toward a subscription payment.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject2': new RecurringBillingApi.InlineObject2() // InlineObject2 | 
};
apiInstance.payBill(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject2** | [**InlineObject2**](InlineObject2.md)|  | [optional] 

### Return type

[**InlineResponse2002**](InlineResponse2002.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json


## updateSubscription

> InlineResponse200 updateSubscription(ePIId, ePISignature, opts)

Update Subscription

Update data related to a subscription.

### Example

```javascript
import RecurringBillingApi from 'recurring_billing_api';

let apiInstance = new RecurringBillingApi.CreateAndManageSubscriptionsApi();
let ePIId = 1111-222222-3-4; // String | Merchant's unique 4-part key, which is provided after boarding with the processor
let ePISignature = "ePISignature_example"; // String | HMAC of the endpoint and payload
let opts = {
  'inlineObject': new RecurringBillingApi.InlineObject() // InlineObject | 
};
apiInstance.updateSubscription(ePIId, ePISignature, opts, (error, data, response) => {
  if (error) {
    console.error(error);
  } else {
    console.log('API called successfully. Returned data: ' + data);
  }
});
```

### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ePIId** | **String**| Merchant&#39;s unique 4-part key, which is provided after boarding with the processor | 
 **ePISignature** | **String**| HMAC of the endpoint and payload | 
 **inlineObject** | [**InlineObject**](InlineObject.md)|  | [optional] 

### Return type

[**InlineResponse200**](InlineResponse200.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

