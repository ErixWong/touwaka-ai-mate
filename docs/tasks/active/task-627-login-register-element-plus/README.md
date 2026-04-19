# Task 627: LoginView/RegisterView Element Plus 重构 - 修复

## 目标
修复代码审计发现的问题

## 修复清单

### 高优先级
- [x] 添加翻译键: login.accountRequired
- [x] 添加翻译键: login.passwordRequired
- [x] 修复 LoginView.vue:111 的 any 类型
- [x] 修复 RegisterView.vue:270 的 any 类型
- [x] 修复 RegisterView.vue:196 未使用的 err 变量

### 中优先级
- [x] 统一错误处理风格

## 分支
feature/627-login-register-element-plus

## 修复详情

### 1. 翻译键添加 (zh-CN.ts & en-US.ts)
```typescript
// zh-CN.ts
accountRequired: '请输入账号',
passwordRequired: '请输入密码',

// en-US.ts
accountRequired: 'Please enter your account',
passwordRequired: 'Please enter your password',
```

### 2. LoginView.vue 错误处理
```typescript
// 修改前:
} catch (err: any) {
  error.value = err.message || err.response?.data?.message || t('login.error')

// 修改后:
} catch (err: unknown) {
  const errorMsg = err instanceof Error ? err.message : t('login.error')
  error.value = errorMsg
```

### 3. RegisterView.vue 错误处理
```typescript
// 修改前 (validateInvitationCode):
} catch (err) {

// 修改后:
} catch {

// 修改前 (handleRegister):
} catch (err: any) {
  error.value = err.response?.data?.message || t('register.error')

// 修改后:
} catch (err: unknown) {
  const errorMsg = err instanceof Error ? err.message : t('register.error')
  error.value = errorMsg
```

## 验证结果
- ✅ ESLint 通过 (LoginView.vue & RegisterView.vue 无错误)
- ✅ i18n 检查通过 (login 相关翻译键已补全)

## 审查
- [x] 代码风格一致
- [x] 功能符合需求
- [x] 无明显问题

## Git
- 分支: `feature/627-login-register-element-plus`
- 目标: `master`
- 提交数: 3
