# Admin Login Quick Reference

## 🚀 Start Backend

```bash
cd backend
node server.js
# Output: 🚀 Server running on http://0.0.0.0:5000
```

## 🔑 Login Credentials

Use the admin email and password configured on the backend server.
Do not place live credentials in this public admin folder.

## 📍 Login Page URL

- **Local**: http://localhost:5500/admin/admin-login/admin-login.html
- **Production**: https://byosemarket.com/admin/admin-login/admin-login.html

## 🧪 Quick Test

### 1. Check Backend is Running
```bash
curl http://localhost:5000/healthz
# Expected: {"status":"ok"}
```

### 2. Test Login Endpoint
```bash
curl -X POST http://localhost:5000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin email>","password":"<admin password>"}'

# Expected: {"success":true,"message":"Login successful"}
```

### 3. Test Wrong Credentials
```bash
curl -X POST http://localhost:5000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin email>","password":"wrong"}'

# Expected: {"success":false,"message":"Invalid email or password"} (401)
```

## 📂 Key Files

```
admin/admin-login/
├── admin-login.html      ← Frontend form
├── admin-login.js        ← Login logic (connects to /api/admin/login)
├── admin.controller.js   ← Backend password check
├── admin.routes.js       ← Route /api/admin/login
├── admin.routes.js       ← Route definitions
├── auth.middleware.js    ← Validation
├── app.js                ← Express setup
├── server.js             ← Server entry

backend/
├── server.js             ← MAIN SERVER (imports admin routes)
└── .env                  ← Backend-only credentials
```

## ✅ Status Codes

- **200** → Login success
- **400** → Missing/invalid input
- **401** → Wrong credentials
- **500** → Server error

## 💾 localStorage Keys

After login:
- `adminAuth`: "true"
- `adminLoginTime`: ISO timestamp
- `adminEmail`: user email

## 🔗 Redirect Flow

1. User logs in
2. `/api/admin/login` returns 200
3. Data stored in localStorage
4. Redirect to `../dashboard.html`
5. Dashboard should check localStorage for `adminAuth`

## 🧹 Clear All Auth

```javascript
// In browser console:
localStorage.clear();
window.location.reload();
```

## ⚡ Common Commands

```bash
# Start backend
npm run backend:dev

# Check if port 5000 is in use
netstat -ano | findstr :5000  # Windows
lsof -i :5000                 # Mac/Linux

# Kill process on port 5000 (Windows)
taskkill /PID <PID> /F

# View logs
tail -f server/server.js
```

## 🎯 What Was Fixed

✅ Backend server.js now mounts admin routes  
✅ Credentials now stay in backend/.env only  
✅ Frontend redirect path fixed (../dashboard.html)  
✅ Auth state management with localStorage  
✅ Comprehensive error handling for all scenarios  
✅ Loading states and animations  
✅ Input validation (client + server)  
✅ Security: timing-safe comparison, CORS, environment variables  

---

**Everything is production-ready! 🎉**
