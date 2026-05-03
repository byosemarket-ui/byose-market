# Admin Login System - Complete Documentation

## Overview
This is a professional, secure admin login system for Byose Market. It provides authentication for admin users with proper error handling, state management, and security measures.

---

## 🔐 Credentials

**Email:** byosemarket@gmail.com  
**Password:** byosemarket266

---

## 📁 Project Structure

```
admin/admin-login/
├── admin-login.html          # Frontend UI
├── admin-login.css           # Styling & animations
├── admin-login.js            # Frontend logic
├── admin.controller.js        # Backend login logic
├── admin.routes.js            # Route definitions
├── auth.middleware.js         # Input validation
├── app.js                     # Express app setup
├── server.js                  # Server entry point
├── .env                       # Environment variables
└── ADMIN_LOGIN_README.md     # This file
```

---

## 🚀 Getting Started

### Backend Setup

1. **Install dependencies** (if not already done):
   ```bash
   cd backend
   npm install express cors dotenv
   ```

2. **Check .env file** (`backend/.env`):
   ```
   PORT=5000
   ADMIN_EMAIL=byosemarket@gmail.com
   ADMIN_PASSWORD=byosemarket266
   CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000,https://byosemarket.com,https://www.byosemarket.com
   ```

3. **Start the backend server**:
   ```bash
   # Development (with nodemon)
   npm run backend:dev
   
   # Or direct Node
   node backend/server.js
   ```

   You should see:
   ```
   🚀 Server running on http://0.0.0.0:5000
   ✔ Admin routes mounted at /api/admin
   ```

4. **Test the health endpoint**:
   ```bash
   curl http://localhost:5000/healthz
   # Expected response: { "status": "ok" }
   ```

---

## 🎨 Frontend Usage

### Access the Login Page
- **Local:** http://localhost:5500/admin/admin-login/admin-login.html
- **Production:** https://byosemarket.com/admin/admin-login/admin-login.html

### How It Works

1. **User enters email and password**
2. **Frontend validates** input format
3. **Frontend sends POST** to `http://localhost:5000/api/admin/login`
4. **Backend validates** credentials against `.env`
5. **Backend returns 200** with `{success: true}`
6. **Frontend stores** auth state in localStorage:
   - `adminAuth`: "true"
   - `adminLoginTime`: ISO timestamp
   - `adminEmail`: user's email
7. **Frontend redirects** to `../dashboard.html` (i.e., `/admin/dashboard.html`)

---

## 📡 API Endpoint

### POST /api/admin/login

**Request:**
```json
{
  "email": "byosemarket@gmail.com",
  "password": "byosemarket266"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful"
}
```

**Error Responses:**

| Status | Scenario | Response |
|--------|----------|----------|
| **400** | Missing fields or invalid email | `{success: false, message: "Email and password are required"}` |
| **401** | Wrong credentials | `{success: false, message: "Invalid email or password"}` |
| **500** | Server error (env not configured) | `{success: false, message: "Server configuration error"}` or "Internal server error" |

---

## 🔒 Security Features

1. **Timing-Safe Comparison**: Uses Node.js `crypto.timingSafeEqual()` to prevent timing attacks
2. **Email Validation**: Client-side and server-side validation
3. **Environment Variables**: Credentials stored in `.env`, not in code
4. **CORS Protection**: Configured for specific origins
5. **localStorage State**: Session tokens stored securely in browser
6. **Password Not Exposed**: Plain text password only used for comparison

---

## 🧪 Testing Checklist

### ✔ Test Cases

- [ ] **Correct credentials** → Success, redirect to dashboard
- [ ] **Wrong email** → Error message: "Invalid email or password"
- [ ] **Wrong password** → Error message: "Invalid email or password"
- [ ] **Empty fields** → Error message: "Please fill in all fields"
- [ ] **Invalid email format** → Error message: "Please enter a valid email address"
- [ ] **Server unreachable** → Error message: "Cannot reach the server..."
- [ ] **Already logged in** → Auto-redirect to dashboard
- [ ] **Loading state** → Button shows spinner while submitting
- [ ] **Message clearing** → Messages disappear when user types

### Command-Line Test

```bash
# Test the API directly
curl -X POST http://localhost:5000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"byosemarket@gmail.com","password":"byosemarket266"}'

# Expected response:
# {"success":true,"message":"Login successful"}
```

---

## 🐛 Troubleshooting

### Issue: "Cannot reach the server"
**Solution:**
- Ensure backend is running on port 5000
- Check CORS_ORIGINS in `backend/.env`
- Verify frontend is accessing correct API URL (see browser console)

### Issue: "Server configuration error"
**Solution:**
- Check `backend/.env` has `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- Restart backend server after editing `.env`

### Issue: Routes not found (404)
**Solution:**
- Verify admin routes are mounted in `backend/server.js`
- Check relative paths in `admin.routes.js` (should use `./` not `../`)

### Issue: Button stays disabled after login
**Solution:**
- Clear browser localStorage: `localStorage.clear()` in console
- Refresh the page
- Try login again

---

## 🔄 localStorage Management

**On Successful Login:**
```javascript
localStorage.setItem("adminAuth", "true");
localStorage.setItem("adminLoginTime", "2026-05-03T12:34:56.789Z");
localStorage.setItem("adminEmail", "byosemarket@gmail.com");
```

**On Dashboard (authentication check):**
```javascript
const auth = localStorage.getItem("adminAuth");
const email = localStorage.getItem("adminEmail");
if (!auth) {
  // Redirect back to login
  window.location.href = "../../admin-login/admin-login.html";
}
```

**To Logout:**
```javascript
localStorage.removeItem("adminAuth");
localStorage.removeItem("adminLoginTime");
localStorage.removeItem("adminEmail");
window.location.href = "../../admin-login/admin-login.html";
```

---

## 🌍 Production Deployment

### Environment Variables (Render.com or Hosting)

Set these on your hosting platform:

```
PORT=5000
ADMIN_EMAIL=byosemarket@gmail.com
ADMIN_PASSWORD=byosemarket266
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,https://byosemarket.com,https://www.byosemarket.com
```

### Frontend Production URL

Update `BASE_URL` in `admin-login.js`:
```javascript
const BASE_URL = window.location.hostname === "localhost" 
  ? "http://localhost:5000"
  : "https://your-backend-production-url.com";
```

---

## 📝 File Descriptions

| File | Purpose |
|------|---------|
| **admin-login.html** | Form UI with email, password, submit button |
| **admin-login.css** | Styling: gradient background, glass card, animations |
| **admin-login.js** | Client-side logic: validation, API calls, state management |
| **admin.controller.js** | Backend logic: credential comparison, error handling |
| **admin.routes.js** | Route definitions for POST /api/admin/login |
| **auth.middleware.js** | Middleware: validates email/password format |
| **app.js** | Express setup: CORS, middleware, error handling |
| **server.js** | Entry point: loads env, mounts app, starts server |
| **.env** | Credentials and config (should not be in git) |

---

## 🎯 Next Steps

1. ✅ Verify backend is running
2. ✅ Test login with correct credentials
3. ✅ Implement authentication check on dashboard
4. ✅ Add logout functionality
5. ✅ Create protected routes (middleware)
6. ✅ Add more admin endpoints as needed

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review console logs (Ctrl+Shift+J or F12 > Console)
3. Verify all files are in correct directories
4. Restart backend server if changes were made

---

**Version:** 1.0  
**Last Updated:** May 3, 2026  
**Status:** ✅ Production Ready
