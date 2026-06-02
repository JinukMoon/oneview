<div align="center">
  <img src="assets/oneview_logo.png" width="160" alt="OneView" />
  <h1>OneView</h1>
  <p>광고 없이 <b>PDF · 한글(HWP/HWPX) · Word · Excel · PPT · 이미지</b>를<br>한 앱에서 여는 무료 Android 문서 뷰어.</p>
</div>

---

## 📥 다운로드

**[➡️ OneView.apk 받기 (항상 최신)](https://github.com/JinukMoon/oneview/releases/latest/download/OneView.apk)**

폰에서 위 링크를 누르면 APK가 바로 받아집니다.
설치 시 "출처를 알 수 없는 앱 허용"을 한 번 켜 주세요. (Android 13/14 기준)

## 왜 만들었나

휴대폰에서 문서를 열려면 포맷마다 앱이 따로고, 대부분 광고·로그인 범벅입니다.
특히 **HWP/HWPX는 휴대폰에서 멀쩡히 볼 무료 수단이 거의 없습니다.**

OneView는 **하나의 진입점**에서 대부분을 직접 열고, 직접 못 그리는 건 가장 잘하는 앱으로 넘깁니다.
**광고 없음 · 로그인 없음 · 서버 없음(오프라인) · 무료.**

## 지원 포맷

| 형식 | 처리 |
|---|---|
| PDF (한글 폰트 포함) | 인앱 렌더 (pdf.js) |
| HWP (.hwp) | 인앱 시각 렌더 (hwp.js) |
| HWPX (.hwpx) | 인앱 텍스트 추출 |
| Word (.docx) | 인앱 렌더 (mammoth) |
| Excel (.xlsx/.xls) | 인앱 표 렌더 (SheetJS) |
| PowerPoint (.pptx) | 인앱 정적 미리보기 + PowerPoint로 슬라이드쇼 전달 |
| 이미지 / 텍스트 | 인앱 (텍스트 한글 인코딩 자동 감지) |
| 그 외(.doc/.ppt/.rtf/.odf/.epub …) | 설치된 앱으로 자동 전달 |

기타: 카톡·메일 "열기 목록" 자동 등장 · 다크 모드 · 야간 반전 · 콘텐츠 전용 줌 · 최근 본 파일 · 공유.

## 빌드

요구: Node 18+, JDK 17, Android SDK (platform-34, build-tools 34).

```bash
npm install
node build.mjs            # 뷰어 라이브러리 번들 + pdf.js cmaps/폰트 복사 → www/vendor/
npx cap copy android      # 웹 자산을 안드로이드로 동기화
cd android && ./gradlew assembleDebug
# 결과: android/app/build/outputs/apk/debug/app-debug.apk
```

## 기술 / 크레딧

[Capacitor](https://capacitorjs.com) (WebView 래퍼) 위에서 동작하며, 아래 오픈소스 렌더러를 사용합니다:
[pdf.js](https://github.com/mozilla/pdf.js) ·
[hwp.js](https://github.com/hahnlee/hwp.js) ·
[mammoth.js](https://github.com/mwilliamson/mammoth.js) ·
[SheetJS](https://github.com/SheetJS/sheetjs) ·
[pptx-preview](https://github.com/501351981/pptx-preview) ·
[fflate](https://github.com/101arrowz/fflate).

## 한계

- HWPX는 레이아웃 없이 **텍스트 위주**로 보여줍니다.
- PPT는 **정적 미리보기**입니다. 애니메이션·슬라이드쇼는 PowerPoint 앱으로 넘깁니다 (해당 엔진은 오픈소스로 재현 불가).
- 개인용으로 만든 프로젝트입니다. 복잡한 문서는 일부 깨질 수 있습니다.

## 라이선스

[MIT](LICENSE). 번들된 라이브러리는 각자의 라이선스(Apache-2.0 / MIT 등)를 따릅니다.
