# Booking API Documentation

Base URL: `http://localhost:3001` (or your production URL)

## Authentication
APIs generally require authentication. You can authenticate either by:
1.  **Session Cookie**: Being logged in via the web session.
2.  **Google ID**: Passing `googleId` in the request body (POST) or query parameters (GET).

---

## 1. Save Booking (Push Data)
Save a new flight booking to the database.

*   **Endpoint:** `POST /api/user/bookings`
*   **Content-Type:** `application/json`

### Request Body Parameters

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `googleId` | String | Yes* | Google ID of the user (if not using session auth). |
| `bookingId` | String | No | The unique booking ID returned from the flight supplier API. |
| `pnr` | String | No | The PNR (Passenger Name Record) for the flight. |
| `status` | String | No | Status of the booking (e.g., 'Pending', 'Confirmed', 'Failed'). Defaults to 'Pending'. |
| `amount` | Number | No | Total amount for the booking. |
| `flightDetails` | Object | No | A JSON object containing snapshot details of the flight (origin, destination, times, etc.). |
| `passengerDetails`| Array | No | An array of passenger objects. |
| `responseJson` | Object | No | The full raw JSON response from the supplier API for debugging/records. |

*\*Required if user is not logged in via session.*

### Example Request
```json
{
  "googleId": "1002023020302020",
  "bookingId": "BO-12345678",
  "pnr": "AB12CD",
  "status": "Confirmed",
  "amount": 5400,
  "flightDetails": {
    "from": "DEL",
    "to": "BOM",
    "airline": "Indigo",
    "flightNumber": "6E-202"
  },
  "passengerDetails": [
    { "name": "John Doe", "age": 30 },
    { "name": "Jane Doe", "age": 28 }
  ],
  "responseJson": {
    "apiTraceId": "trace-001",
    "rawData": "..."
  }
}
```

### Example Response (Success)
```json
{
  "success": true,
  "booking": {
    "_id": "60d5ec49f1b2c...",
    "userId": "60d5ec...",
    "bookingId": "BO-12345678",
    "pnr": "AB12CD",
    "status": "Confirmed",
    "amount": 5400,
    "createdAt": "2025-12-25T10:00:00.000Z",
    ...
  }
}
```

---

## 2. Save App Booking (Custom Payload)
Special endpoint for app booking saving with specific structure.

*   **Endpoint:** `POST /appbooking`
*   **Content-Type:** `application/json`

### Request Body
```json
{
    "googleId": "10320320...",
    "orderId": "ORD-12399...",
    "isLCC": false, 
    "TraceId": "6ebd2456-...",
    "ResultIndex": "OB12...",
    "Passengers": [
        {
            "Title": "Mr",
            "FirstName": "John",
            "LastName": "Doe",
            "PaxType": 1,
            "DateOfBirth": "2000-01-15T00:00:00",
            "Gender": 1,
            "PassportNo": "A1234567",
            "Fare": {
                "BaseFare": 3690,
                "Tax": 678,
                "YQTax": 0,
                "AdditionalTxnFeePub": 0,
                "AdditionalTxnFeeOfrd": 0,
                "OtherCharges": 0
            },
            ...
        }
    ]
}
```

### Example Response
```json
{
    "success": true,
    "message": "Booking saved successfully",
    "booking": { ... }
}
```

---

## 3. Get User Bookings
Retrieve all bookings for a specific user.

*   **Endpoint:** `GET /api/user/bookings`

### Query Parameters

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `googleId` | String | Yes* | Google ID of the user (if not using session auth). |

### Example Request
`GET /api/user/bookings?googleId=1002023020302020`

### Example Response
```json
[
  {
    "_id": "60d5ec49f1b2c...",
    "bookingId": "BO-12345678",
    "status": "Confirmed",
    "amount": 5400,
    "flightDetails": {...},
    "createdAt": "..."
  },
  ...
]
```

---

## 4. Get Booking Details
Retrieve details of a specific booking by its MongoDB ID.

*   **Endpoint:** `GET /api/user/bookings/:id`

### Query Parameters

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `googleId` | String | Yes* | Google ID of the user (for ownership verification). |

### Example Request
`GET /api/user/bookings/60d5ec49f1b2c...?googleId=1002023020302020`

### Example Response
```json
{
  "_id": "60d5ec49f1b2c...",
  "bookingId": "BO-12345678",
  "pnr": "AB12CD",
  "status": "Confirmed",
  "amount": 5400,
  "flightDetails": {...},
  "passengerDetails": [...],
  "responseJson": {...},
  "createdAt": "..."
}
```
