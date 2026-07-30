# ToolNest API Documentation

All REST APIs communicate via JSON format payloads. Protected administrative routes require a JWT `Bearer` token header.

---

## 1. Authentication Endpoints

### Register User
*   **Endpoint**: `POST /api/v1/auth/signup`
*   **Payload**:
    ```json
    {
      "email": "user@example.com",
      "password": "securepassword",
      "fullName": "John Doe"
    }
    ```

### Login Session
*   **Endpoint**: `POST /api/v1/auth/login`
*   **Payload**:
    ```json
    {
      "email": "user@example.com",
      "password": "securepassword"
    }
    ```
*   **Response**:
    ```json
    {
      "status": "success",
      "accessToken": "eyJhbGciOi...",
      "user": { "id": 1, "email": "user@example.com", "role": "user" }
    }
    ```

---

## 2. Blog CMS Endpoints

### List Active Blogs
*   **Endpoint**: `GET /api/v1/blog`
*   **Parameters**: `page`, `limit`, `search`, `category`, `tag`

### Create Blog (Admin Protected)
*   **Endpoint**: `POST /api/v1/blog/admin/blogs`
*   **Headers**: `Authorization: Bearer <JWT_TOKEN>`
*   **Payload**:
    ```json
    {
      "title": "Article Title",
      "content": "<p>Content body</p>",
      "summary": "Short snippet...",
      "slug": "article-title",
      "status": "draft"
    }
    ```

---

## 3. Subscription & Billing Endpoints

### Create Checkout Session
*   **Endpoint**: `POST /api/v1/subscription/checkout`
*   **Headers**: `Authorization: Bearer <JWT_TOKEN>`
*   **Payload**:
    ```json
    {
      "planName": "monthly",
      "provider": "stripe",
      "couponCode": "SAVE20"
    }
    ```
*   **Response**:
    ```json
    {
      "status": "success",
      "data": { "url": "https://checkout.stripe.com/..." }
    }
    ```

### Cancel Subscription
*   **Endpoint**: `POST /api/v1/subscription/cancel`
*   **Headers**: `Authorization: Bearer <JWT_TOKEN>`

---

## 4. Admin Dashboard Endpoints (Admin Guarded)

### Retrieve Overview Stats
*   **Endpoint**: `GET /api/v1/admin/dashboard/overview`

### Update User Role
*   **Endpoint**: `PUT /api/v1/admin/dashboard/users/:id/role`
*   **Payload**: `{"role": "premium"}`

### Switch Feature Flags (Tool status)
*   **Endpoint**: `PUT /api/v1/admin/dashboard/tools/:id/status`
*   **Payload**: `{"status": "beta"}`
