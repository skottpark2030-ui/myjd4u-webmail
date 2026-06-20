# My Job for You · 웹메일

`myjd4u.com`(정확히는 `mail.myjd4u.com`)에서 직접 메일을 주고받는 웹메일입니다.
화면(로그인·받은편지함·읽기·쓰기)과, Zoho IMAP/SMTP에 연결하는 작은 백엔드로 구성됩니다.

---

## 0. 먼저 Zoho 쪽 준비 (이게 안 되면 동작 안 함)

### (1) Mail Lite 이상으로 업그레이드
무료 플랜은 IMAP/SMTP가 막혀 있어 외부 프로그램이 못 붙습니다.
Zoho 관리 콘솔 → 요금제 → **Mail Lite**(약 $1.25/월) 이상으로 전환.

### (2) IMAP 사용 설정
`mail.zoho.com` 로그인 → 설정(톱니) → **메일 계정 / IMAP** → IMAP 사용 **켜기**.

### (3) 앱 전용 비밀번호 발급  ← 로그인에 쓸 값
일반 비밀번호 말고, 앱 전용 비밀번호를 씁니다.
`accounts.zoho.com` → **보안 → 앱 비밀번호 → 생성** → 이름(예: webmail) 입력 → 생성된 비밀번호를 복사해 둡니다.
(이 비밀번호를 웹메일 로그인 칸의 "앱 전용 비밀번호"에 입력)

---

## 1. 배포 (Render, 무료)

1. GitHub에 새 저장소(repo)를 만들고 이 폴더의 파일을 올립니다.
2. https://render.com 가입 → **New → Web Service** → 그 저장소 연결.
3. 설정:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - 환경변수(Environment):
     - `NODE_ENV` = `production`
     - `SESSION_SECRET` = 아무 긴 임의 문자열
4. 배포되면 `https://xxxx.onrender.com` 주소가 생깁니다. 거기 들어가 로그인 테스트.

> 무료 플랜은 한동안 안 쓰면 잠들어서(cold start) 첫 접속이 30초쯤 느릴 수 있습니다. 개인용으론 무난합니다.

---

## 2. mail.myjd4u.com 붙이기

1. Render → 그 서비스 → **Settings → Custom Domains → Add** → `mail.myjd4u.com` 입력.
2. Render가 CNAME 대상(예: `xxxx.onrender.com`)을 알려줍니다.
3. Cloudflare → `myjd4u.com` → DNS → **CNAME** 추가:
   - Name: `mail`
   - Target: Render가 준 값
   - Proxy: **DNS only(회색 구름)** 권장
4. 몇 분 뒤 `https://mail.myjd4u.com` 으로 접속됩니다.

(원하면 메인 사이트 `myjd4u.com`에 "메일" 링크를 달아 `mail.myjd4u.com`으로 연결)

---

## 알아둘 점 / 한계 (v1)

- 개인용으로 만든 단순 버전입니다. **받은편지함(최근 25통) 보기 · 읽기 · 보내기 · 답장**까지 됩니다.
- 아직 없는 것: 첨부파일, 폴더(보낸편지함 등), 검색, 실시간 알림, 스레드. 필요하면 추가 가능.
- 보안: 로그인 시 입력한 **앱 전용 비밀번호**는 서버 세션(메모리)에만 보관되고 8시간 뒤 만료됩니다. 일반 비밀번호 말고 반드시 앱 전용 비밀번호를 쓰세요. 문제가 생기면 Zoho에서 그 앱 비밀번호만 폐기하면 됩니다.
- 이 주소는 본인 메일함 로그인 화면이므로, 공개돼 있어도 비밀번호를 모르면 들어올 수 없습니다.

---

## 로컬에서 먼저 돌려보기 (선택)

```bash
npm install
SESSION_SECRET=test node server.js
# http://localhost:3000 접속
```
