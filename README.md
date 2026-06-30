# WHO.A.U Weekly Sales Top 10

26년도 상품의 주판량 기준 Top 10 대시보드입니다.

## 화면 기준

- 주판량: 최신 주차의 판매 수량(`weekly.actualQty`)
- 기간: 실행일 기준 직전 월요일~일요일(`targetWeekLabel`)
- 대상: 26년도 상품
- 분류: 스타일코드 3~4번째 문자로 아이템 구분

## 실행

브라우저에서 `index.html`을 열면 됩니다.

## 데이터 갱신

현재 데이터 파일은 `data/app-data.js`이고 이미지는 `data/image-map.js`입니다. DaaS에서 `MATERIAL` 앞 2자리가 `WH`인 상품만 가져와 갱신하려면:

```powershell
npm.cmd install
npm.cmd run generate:daas
```

데이터와 `https://whoau.com/` 공식 상품 이미지를 함께 갱신하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-weekly-dashboard.ps1
```

매주 월요일 오전 8시에 직전 월요일~일요일 기준 DaaS 데이터와 공식 상품 이미지를 자동 갱신하도록 Windows 작업 스케줄러에 등록하려면:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-weekly-update.ps1
```

DB 접속 정보는 주석 없는 `.env`에서 읽습니다. `.env`는 git에 포함하지 않습니다.

## 공유 실행

주변 사람에게 같은 네트워크에서 보여줄 때는 정적 웹서버로 실행합니다.

```powershell
npm.cmd start
```

실행 후 같은 네트워크 사용자는 `http://내-PC-IP:8080/` 주소로 접속합니다. PC 방화벽이나 사내 네트워크 정책이 외부 접속을 막으면 사내 웹서버나 정적 호스팅에 이 폴더를 배포해야 합니다.
