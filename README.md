<div align="center">
  <img src="assets/oneview_logo.png" width="150" alt="OneView" />
  <h1>OneView</h1>
  <p><b>PDF · 한글(HWP/HWPX) · Word · Excel · PPT · 이미지</b>를<br>광고 없이 앱 하나로 바로 여는 무료 Android 문서 뷰어.</p>
  <p>
    <img alt="platform" src="https://img.shields.io/badge/platform-Android-3ddc84" />
    <img alt="price" src="https://img.shields.io/badge/무료-광고없음-2f81f7" />
    <img alt="offline" src="https://img.shields.io/badge/오프라인-서버없음-8b949e" />
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>
</div>

---

## 📥 다운로드

**[➡️ OneView.apk 받기 (항상 최신)](https://github.com/JinukMoon/oneview/releases/latest/download/OneView.apk)**

폰에서 위 링크를 누르면 APK가 바로 받아집니다.
설치 시 **"출처를 알 수 없는 앱 허용"** 을 한 번 켜 주세요. (Android 13/14 기준)

---

## 왜 만들었나

휴대폰에서 문서를 열려면 포맷마다 앱이 따로고, 대부분 **광고·로그인 범벅**입니다.
특히 **HWP/HWPX는 휴대폰에서 멀쩡히 볼 무료 수단이 거의 없습니다.**

OneView는 **하나의 진입점**에서 대부분을 직접 열고, 직접 못 그리는 건 가장 잘하는 앱으로 넘깁니다.

> **광고 없음 · 로그인 없음 · 서버 없음(오프라인) · 무료.**
> 파일은 폰 밖으로 나가지 않습니다.

---

## 지원 포맷

| 형식 | 처리 방식 |
|---|---|
| **PDF** (한글 폰트 포함) | 인앱 렌더 · 확대 시 해당 배율로 다시 그려 선명 (pdf.js) |
| **HWP** (.hwp) | 인앱 시각 렌더 (@rhwp/core, WASM) |
| **HWPX** (.hwpx) | 인앱 시각 렌더 (@rhwp/core, WASM) |
| **Word** (.docx) | 인앱 렌더 · 표/스타일 유지 (docx-preview) |
| **Excel** (.xlsx/.xls) | 인앱 표 렌더 · **시트 탭으로 전환** (ExcelJS, SheetJS 폴백) |
| **PowerPoint** (.pptx) | 인앱 정적 미리보기 · **슬라이드 세로 스크롤** + PowerPoint로 넘기기 |
| **이미지** (jpg/png/gif/webp/svg …) | 인앱 렌더 |
| **텍스트** (txt/csv/md/json/xml …) | 인앱 · 한글 인코딩 자동 감지(UTF-8/EUC-KR) |
| 그 외 (.doc/.ppt/.rtf/.odf/.epub · HEIC/HEIF …) | 설치된 앱으로 자동 전달 |

---

## 주요 기능

- **📐 비율 그대로 확대/축소** — 핀치 + 버튼 줌(25%~600%). 가로·세로 균일 스케일이라 문서가 늘어나지 않고, 확대하면 가로 스크롤로 패닝됩니다.
- **🔍 PDF는 확대할수록 선명** — 보는 배율에 맞춰 페이지를 다시 렌더링(메모리 상한 내). 페이지 크기가 섞인 문서(세로+가로)도 각자 비율 유지.
- **🖼 슬라이드/페이지 세로 스크롤** — PPT는 슬라이드가 위→아래로 쭉, 아래로 넘기며 훑어볼 수 있습니다.
- **📑 엑셀 시트 전환** — 상단 고정 탭 버튼으로 시트를 골라 이동.
- **🏠 홈/뒤로가기** — 상단 홈 버튼 + 안드로이드 하드웨어 뒤로가기로 문서에서 언제든 첫 화면으로.
- **🌙 다크 모드 + 야간 반전(다크 리더)** — 흰 문서를 어둡게 반전(사진은 원색 유지).
- **🔎 문서 내 검색** — Word/Excel/HWPX/텍스트에서 하이라이트 검색.
- **🕘 최근 본 파일** — 카톡 다시 안 뒤져도 재열람.
- **↗ 공유 / 다른 앱으로 열기** — 못 그리는 포맷은 가장 잘 여는 앱으로 넘김.
- **📨 열기 목록 자동 등장** — 카톡·메일에서 파일을 누르면 OneView가 후보로 뜹니다.

---

## 빌드

### Android

요구: **Node 18+, JDK 17, Android SDK (platform-34, build-tools 34).**

```bash
npm install
node build.mjs            # 뷰어 라이브러리 번들 + pdf.js cmaps/폰트 복사 → www/vendor/
npx cap copy android      # 웹 자산을 안드로이드로 동기화
cd android && ./gradlew assembleDebug
# 결과: android/app/build/outputs/apk/debug/app-debug.apk
```

`www/`(HTML·CSS·JS)만 고쳤다면 `node build.mjs`는 생략하고 `npx cap copy android` 후 다시 빌드하면 됩니다.

### iOS

요구: **Node 18+, macOS + Xcode 15+, CocoaPods.**

```bash
npm install
node build.mjs            # 뷰어 라이브러리 번들 + pdf.js cmaps/폰트 복사 → www/vendor/
npx cap sync ios          # 웹 자산 동기화 + pod install
npx cap open ios          # Xcode에서 열림 → Signing 설정 후 Run
```

기기/시뮬레이터 실행에는 Xcode 서명이 필요합니다(개인 Apple ID 무료 서명으로 충분).
뷰어 코어는 Android와 동일한 웹 번들을 그대로 사용하며, 네이티브 브릿지(`FileBridge`)만 Swift로 구현되어 있습니다(`ios/App/App/FileBridgePlugin.swift`).

---

## 기술 / 크레딧

[Capacitor](https://capacitorjs.com) (WebView 래퍼) 위에서 순수 클라이언트 사이드로 동작하며, 아래 오픈소스 렌더러를 사용합니다:

[pdf.js](https://github.com/mozilla/pdf.js) ·
[@rhwp/core](https://github.com/edwardkim/rhwp) ·
[docx-preview](https://github.com/VolodymyrBaydalka/docxjs) ·
[ExcelJS](https://github.com/exceljs/exceljs) ·
[SheetJS](https://github.com/SheetJS/sheetjs) ·
[pptx-preview](https://github.com/501351981/pptx-preview) ·
[fflate](https://github.com/101arrowz/fflate).

---

## 한계

- **HWP/HWPX** — @rhwp/core로 시각 렌더하지만, 복잡하거나 암호화·배포용 문서는 일부 깨지거나 표시가 안 될 수 있습니다(이 경우 한컴 등 다른 앱으로 넘깁니다).
- **PPT** — 정적 미리보기입니다. 애니메이션·슬라이드쇼는 PowerPoint 앱으로 넘깁니다(해당 엔진은 오픈소스로 재현 불가). 매우 큰 덱은 느릴 수 있어 상단 버튼으로 PowerPoint에 넘길 수 있습니다.
- **PDF** — 벡터 원본이 아니라 배율별 래스터 렌더입니다(무한 확대 시 완벽한 벡터 선명함은 네이티브 PDF 엔진에서만 가능).
- **HEIC/HEIF** — WebView가 직접 디코드하지 못해 사진 앱으로 넘깁니다.
- 개인용으로 만든 프로젝트입니다. 복잡한 문서는 일부 깨질 수 있습니다.

---

## 라이선스

[MIT](LICENSE). 번들된 라이브러리는 각자의 라이선스(Apache-2.0 / MIT 등)를 따릅니다.
