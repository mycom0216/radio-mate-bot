# 라디오메이트 Android

기존 라디오메이트 서버에 연결하는 Java/WebView Android 앱입니다. Android 8.0(API 26) 이상, target/compile SDK 36, Java 21 빌드 환경을 사용합니다. 앱 아이콘은 기존 실행 화면의 라디오 이미지를 재사용합니다.

## 설치와 사용

1. 배포 APK `RadioMate-1.0.0.apk`를 안드로이드 기기로 전달해 설치합니다. 기기가 출처 허용을 요구하면 사용자가 직접 판단하고 진행합니다.
2. 앱을 열고 필요하면 **메뉴 → 서버 주소 설정**에서 운영 중인 HTTPS 주소를 입력합니다.
3. **메뉴 → DJ 계정 연결**을 선택합니다. 기본 브라우저에서 실제 DJ 계정으로 로그인하고 권한에 동의합니다.
4. 연결 완료 페이지에서 **라디오메이트 앱으로 돌아가기**를 누르면 앱 대시보드에 연결됩니다.
5. 웹 화면의 12개 관리 메뉴와 명령어 테스트를 사용합니다. 음성 접수 페이지에서 녹음을 시작할 때만 마이크 권한을 요청합니다. 파일 첨부는 Android 파일 선택기를 사용합니다.

Spoon 계정 로그인은 WebView 안에서 진행하지 않습니다. 서버 OAuth 콜백이 발급하는 2분짜리 일회용 코드를 앱이 보유한 SHA-256 검증값으로 교환해 HttpOnly 세션을 만듭니다. Spoon Client Secret이나 토큰은 APK에 넣지 않습니다. 커스텀 스킴을 가로채도 검증값 없이 세션을 교환할 수 없습니다. 브라우저와 앱의 로그인 세션은 별개입니다.

앱을 닫아도 서버 측 봇은 PC 서버가 켜져 있으면 계속 동작합니다. YouTube 재생은 앱 종료·백그라운드 전환·브라우저 정책에 따라 중단될 수 있으며, 이 앱이 스푼 방송으로 음악을 자동 송출하지는 않습니다. PC 서버와 HTTPS 터널을 계속 운영해야 합니다. 현재 기본 주소는 임시 터널이며 변경될 수 있습니다.

서버의 `/android`가 설치 안내 페이지이고 `/android/RadioMate.apk`가 APK 다운로드 주소입니다. 빌드 스크립트가 생성한 `output/android/RadioMate-1.0.0.apk`가 있어야 다운로드됩니다. Docker 서버에서는 필요한 경우 이 폴더만 `/app/output/android`에 읽기 전용으로 마운트하세요. Android 소스·빌드 캐시·서명키는 서버 이미지에 포함하지 않습니다.

## 재빌드

Android SDK Platform 36과 Java 21을 준비한 뒤 저장소 루트의 PowerShell에서 실행합니다.

```powershell
# 테스트 APK
./tools/build-android.ps1 -DebugBuild

# 기존 서명키와 signing.properties를 준비한 배포 APK + AAB
./tools/build-android.ps1 -ServerUrl 'https://운영도메인'
```

서명 설정은 `signing.properties.example`을 참고합니다. `release-upload.jks`와 `signing.properties`는 이 PC에서 생성했고 Git에서 제외했습니다. **두 파일을 안전한 개인 저장소에 백업하고, 업데이트 때 같은 키를 사용하세요.** 공개 배포 ZIP·GitHub·이메일에 서명키와 암호 파일을 함께 올리면 안 됩니다. 새 PC에서는 키를 새로 생성하는 대신 기존 키를 복원해야 합니다.

일반 Gradle 명령은 다음과 같습니다.

```powershell
cd android
./gradlew.bat :app:assembleDebug :app:lintDebug
./gradlew.bat :app:assembleRelease :app:bundleRelease :app:lintRelease -PserverUrl=https://운영도메인
```

서명 설정이 없으면 Gradle release 결과는 서명되지 않습니다. 제공한 PowerShell 배포 스크립트는 이를 먼저 차단합니다. APK는 직접 설치용, AAB는 Play Console 업로드용입니다. AAB 파일 자체를 휴대폰에서 설치하지 않습니다.

## Google Play 배포 전 남은 작업

- 고정 HTTPS 서버·도메인으로 이전하고 기본 주소를 그 도메인으로 빌드합니다. 임시 터널은 상시 서비스 주소로 적합하지 않습니다.
- 본인의 Play Console 개발자 계정으로 앱을 등록하고 앱 이름·패키지명 중복 여부를 확인합니다.
- 스토어 설명, 아이콘, 실제 안드로이드 스크린샷, 개인정보처리방침 고정 URL을 준비합니다.
- 실제 수집 항목(스푼 DJ 식별자, 청취자 기록, 음성 파일 등)에 맞춰 데이터 보안·계정 삭제·콘텐츠 등급 양식을 작성합니다. 마이크는 음성 접수에만 사용합니다.
- 실기기에서 DJ 로그인, 음성 녹음·첨부, 다운로드, YouTube 첫 재생, 뒤로가기, 서버 주소 변경을 확인합니다.
- 서명된 AAB를 내부 테스트에 올린 후 계정에 적용되는 테스트·심사 절차를 진행합니다. 이 작업에서 스토어 등록이나 심사를 완료하지는 않았습니다.

GitHub Actions의 **Android package** 워크플로는 수동 실행 가능합니다. 서명 secrets가 모두 있으면 서명 APK/AAB를 만들고, 없으면 preview APK만 배포 파일로 올립니다. 서명키 생성·secrets 등록·Play Console 제출은 자동으로 수행하지 않습니다.

## 검증 범위

서버 Node 테스트, 일회용 앱 로그인 만료·재사용 차단·다른 검증값 거절, 모의 Spoon OAuth → 앱 세션 교환, Android APK/AAB 빌드, Android Lint, APK 서명 검증을 수행합니다. 실제 계정 동의와 실제 모바일 기기 음성·재생 검증은 별도로 구분합니다.

참고: [Android 명령행 빌드](https://developer.android.com/build/building-cmdline), [WebChromeClient 파일·마이크 처리](https://developer.android.com/reference/android/webkit/WebChromeClient).
