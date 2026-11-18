package net.radiomate.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small Android host for the existing, server-backed RadioMate application. */
public final class MainActivity extends Activity {
    private static final int AUDIO_PERMISSION = 10, FILE_PICKER = 11, SAVE_FILE = 12;
    private WebView web;
    private ProgressBar progress;
    private TextView error;
    private SharedPreferences prefs;
    private String origin;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest microphone;
    private String downloadUrl;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean exchanging;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("radiomate", MODE_PRIVATE);
        origin = prefs.getString("server", BuildConfig.SERVER_URL);
        if (!validOrigin(origin)) origin = BuildConfig.SERVER_URL;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(255,244,250));
        LinearLayout bar = new LinearLayout(this); bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this); title.setText("♡ 라디오메이트");title.setTextSize(18);title.setTextColor(Color.rgb(143,60,106));
        title.setPadding(dp(16),0,0,0);bar.addView(title,new LinearLayout.LayoutParams(0,dp(52),1));
        Button menu = new Button(this);menu.setText("메뉴 ☰");menu.setOnClickListener(v -> openMenu(menu));bar.addView(menu);
        root.addView(bar);
        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        error = new TextView(this);error.setTextColor(Color.rgb(143,60,106));error.setPadding(dp(16),dp(10),dp(16),dp(10));error.setVisibility(View.GONE);root.addView(error);
        web = new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets) -> {
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        configureWebView();
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::goBack);
        if(!handleCallback(getIntent())) web.loadUrl(origin+"/");
    }

    @SuppressWarnings("SetJavaScriptEnabled") private void configureWebView() {
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setMediaPlaybackRequiresUserGesture(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()+" RadioMateAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if(!request.isForMainFrame()) return false;
                if(trusted(uri)) {
                    if(uri.getPath()!=null&&uri.getPath().startsWith("/oauth/")){startLogin();return true;}
                    return false;
                }
                if("https".equals(uri.getScheme())||"http".equals(uri.getScheme())||"mailto".equals(uri.getScheme()))openExternal(uri);
                return true;
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError ssl){handler.cancel();showError("HTTPS 인증서를 확인할 수 없습니다. 서버 주소와 인증서를 확인해주세요.");}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError e){if(request.isForMainFrame())showError("서버에 연결하지 못했습니다. PC 서버와 HTTPS 터널을 확인한 뒤 메뉴에서 새로고침하세요.");}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){error.setVisibility(View.GONE);progress.setVisibility(View.VISIBLE);}
            @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(!trusted(Uri.parse(view.getUrl()==null?"":view.getUrl())))return false;
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
                Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("audio/*");
                try{startActivityForResult(pick,FILE_PICKER);}catch(ActivityNotFoundException e){fileCallback.onReceiveValue(null);fileCallback=null;toast("파일 선택 앱을 찾을 수 없습니다.");}
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request){
                if(!trusted(request.getOrigin())||!trusted(Uri.parse(web.getUrl()==null?"":web.getUrl()))){request.deny();return;}
                boolean audio=false;for(String r:request.getResources())if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r))audio=true;
                if(!audio){request.deny();return;}
                if(microphone!=null)microphone.deny();microphone=request;
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)grantMicrophone();
                else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},AUDIO_PERMISSION);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(microphone==request)microphone=null;}
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length)->{
            if(!trusted(Uri.parse(url))){toast("이 서버의 파일만 앱에서 저장할 수 있습니다.");return;}
            downloadUrl=url;
            Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT);save.addCategory(Intent.CATEGORY_OPENABLE);save.setType(mime==null?"application/octet-stream":mime);
            save.putExtra(Intent.EXTRA_TITLE,"radiomate-export-"+System.currentTimeMillis()+(mime!=null&&mime.contains("json")?".json":".bin"));
            try{startActivityForResult(save,SAVE_FILE);}catch(ActivityNotFoundException e){downloadUrl=null;toast("파일 저장 앱을 찾을 수 없습니다.");}
        });
    }

    private void openMenu(View anchor){
        android.widget.PopupMenu menu=new android.widget.PopupMenu(this,anchor);
        String[] labels={"대시보드","DJ 계정 연결","신청곡 플레이어","새로고침","서버 주소 설정","브라우저에서 열기","개인정보 안내","앱 정보"};
        for(int i=0;i<labels.length;i++)menu.getMenu().add(Menu.NONE,i,i,labels[i]);
        menu.setOnMenuItemClickListener(item->{switch(item.getItemId()){
            case 0:web.loadUrl(origin+"/");break;
            case 1:startLogin();break;
            case 2:web.loadUrl(origin+"/player");break;
            case 3:web.reload();break;
            case 4:serverDialog();break;
            case 5:openExternal(Uri.parse(origin+"/"));break;
            case 6:web.loadUrl(origin+"/privacy");break;
            case 7:new AlertDialog.Builder(this).setTitle("라디오메이트 "+BuildConfig.VERSION_NAME).setMessage("서버에 연결해 방송을 관리하는 안드로이드 앱입니다.\n\nPC 서버와 HTTPS 주소가 켜져 있어야 합니다. YouTube는 앱을 닫거나 스푼 앱으로 이동하면 재생이 중단될 수 있습니다. 스푼 앱에 음악을 자동 송출하지 않습니다.").setPositiveButton("확인",null).show();break;
            default:break;
        }return true;});menu.show();
    }
    private void serverDialog(){
        EditText field=new EditText(this);field.setSingleLine(true);field.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);field.setText(origin);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("라디오메이트 서버 주소").setMessage("직접 운영하거나 신뢰하는 서버의 HTTPS 주소를 입력하세요. 변경하면 DJ 로그인을 다시 해야 합니다.").setView(field).setNegativeButton("취소",null).setPositiveButton("저장",null).create();
        dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(b->{
            String value=field.getText().toString().trim().replaceAll("/+$","");
            if(!validOrigin(value)){field.setError("경로 없이 https://도메인 형식으로 입력해주세요.");return;}
            web.stopLoading();web.loadUrl("about:blank");web.clearHistory();web.clearCache(true);
            origin=value;prefs.edit().putString("server",origin).remove("verifier").remove("loginOrigin").remove("loginTime").apply();
            CookieManager.getInstance().removeAllCookies(done->{CookieManager.getInstance().flush();web.loadUrl(origin+"/");});dialog.dismiss();
        }));dialog.show();
    }
    private void startLogin(){
        try{
            byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);String verifier=b64(bytes);
            String challenge=b64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
            prefs.edit().putString("verifier",verifier).putString("loginOrigin",origin).putLong("loginTime",System.currentTimeMillis()).apply();
            openExternal(Uri.parse(origin+"/oauth/start?app_challenge="+challenge));
        }catch(Exception e){showError("로그인 연결을 시작하지 못했습니다.");}
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleCallback(intent);}
    private boolean handleCallback(Intent intent){
        Uri data=intent==null?null:intent.getData();
        if(data==null||!"radiomate".equals(data.getScheme())||!"auth".equals(data.getHost()))return false;
        String code=data.getQueryParameter("code"),verifier=prefs.getString("verifier",null);
        long age=System.currentTimeMillis()-prefs.getLong("loginTime",0);
        if(exchanging)return true;
        if(code==null||!code.matches("[A-Za-z0-9_-]{43}")||verifier==null||!origin.equals(prefs.getString("loginOrigin",""))||age<0||age>600000){showError("앱 메뉴에서 DJ 계정 연결을 다시 시작해주세요.");return true;}
        exchanging=true;progress.setVisibility(View.VISIBLE);
        io.execute(()->{
            try{
                HttpURLConnection c=connection(origin+"/api/android/exchange");c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
                byte[] body=new JSONObject().put("code",code).put("verifier",verifier).toString().getBytes(StandardCharsets.UTF_8);
                try(OutputStream output=c.getOutputStream()){output.write(body);}
                if(c.getResponseCode()!=200){c.disconnect();throw new IllegalStateException();}
                List<String> cookies=null;for(Map.Entry<String,List<String>> e:c.getHeaderFields().entrySet())if("Set-Cookie".equalsIgnoreCase(e.getKey()))cookies=e.getValue();
                if(cookies==null){c.disconnect();throw new IllegalStateException();}List<String> accepted=cookies;c.disconnect();
                runOnUiThread(()->{
                    if(isFinishing()||isDestroyed())return;
                    // Only a cookie set by the configured HTTPS server is imported.
                    String studioCookie=null;for(String cookie:accepted)if(cookie.startsWith("studio="))studioCookie=cookie;
                    if(studioCookie==null){clearLogin();showError("서버의 세션 응답을 확인하지 못했습니다.");return;}
                    CookieManager.getInstance().setCookie(origin,studioCookie,ok->{
                        CookieManager.getInstance().flush();clearLogin();
                        if(Boolean.TRUE.equals(ok)){web.loadUrl(origin+"/");toast("DJ 계정이 연결되었습니다.");}
                        else showError("앱에 세션을 저장하지 못했습니다. 다시 연결해주세요.");
                    });
                });
            }catch(Exception e){runOnUiThread(()->{clearLogin();showError("앱 연결이 만료되었거나 서버 연결에 실패했습니다. DJ 계정 연결을 다시 시도해주세요.");});}
        });return true;
    }
    private void clearLogin(){exchanging=false;prefs.edit().remove("verifier").remove("loginOrigin").remove("loginTime").apply();progress.setVisibility(View.GONE);}
    private void saveDownload(Uri target,String source){
        if(target==null||source==null||!trusted(Uri.parse(source)))return;
        String cookies=CookieManager.getInstance().getCookie(source);
        io.execute(()->{
            try{
                HttpURLConnection c=connection(source);if(cookies!=null)c.setRequestProperty("Cookie",cookies);
                if(c.getResponseCode()!=200){c.disconnect();throw new IllegalStateException();}
                try(InputStream in=c.getInputStream();OutputStream out=getContentResolver().openOutputStream(target)){
                    if(out==null)throw new IllegalStateException();byte[] buf=new byte[8192];long total=0;int n;
                    while((n=in.read(buf))!=-1){total+=n;if(total>150L*1024*1024)throw new IllegalStateException();out.write(buf,0,n);}
                }finally{c.disconnect();}runOnUiThread(()->toast("파일을 저장했습니다."));
            }catch(Exception e){runOnUiThread(()->toast("저장하지 못했습니다. 세션과 서버를 확인해주세요. 미완성 파일이 있다면 삭제해주세요."));}
        });
    }
    private HttpURLConnection connection(String url)throws Exception{
        if(!trusted(Uri.parse(url)))throw new IllegalArgumentException();
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);return c;
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==FILE_PICKER&&fileCallback!=null){Uri selected=result==RESULT_OK&&data!=null?data.getData():null;fileCallback.onReceiveValue(selected==null?null:new Uri[]{selected});fileCallback=null;}
        if(request==SAVE_FILE){String source=downloadUrl;downloadUrl=null;if(result==RESULT_OK&&data!=null)saveDownload(data.getData(),source);}
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==AUDIO_PERMISSION){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)grantMicrophone();else if(microphone!=null){microphone.deny();microphone=null;toast("마이크 권한이 없으면 음성 파일 첨부를 이용해주세요.");}}}
    private void grantMicrophone(){if(microphone==null)return;if(trusted(microphone.getOrigin())&&trusted(Uri.parse(web.getUrl()==null?"":web.getUrl())))microphone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else microphone.deny();microphone=null;}
    private boolean trusted(Uri uri){Uri base=Uri.parse(origin);return "https".equals(uri.getScheme())&&base.getHost()!=null&&base.getHost().equalsIgnoreCase(uri.getHost())&&base.getPort()==uri.getPort()&&uri.getUserInfo()==null;}
    private static boolean validOrigin(String value){try{java.net.URI uri=new java.net.URI(value);return "https".equals(uri.getScheme())&&uri.getHost()!=null&&uri.getRawUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null&&(uri.getPath()==null||uri.getPath().isEmpty()||uri.getPath().equals("/"));}catch(Exception e){return false;}}
    private static String b64(byte[] bytes){return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);}
    private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(ActivityNotFoundException e){toast("기본 브라우저를 설치해주세요.");}}
    private void showError(String message){if(isFinishing()||isDestroyed())return;error.setText(message);error.setVisibility(View.VISIBLE);progress.setVisibility(View.GONE);}
    private void toast(String message){if(!isFinishing()&&!isDestroyed())Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void goBack(){if(web.canGoBack())web.goBack();else new AlertDialog.Builder(this).setMessage("라디오메이트 앱을 닫을까요?").setNegativeButton("취소",null).setPositiveButton("닫기",(d,w)->finish()).show();}
    // API 33+ uses the platform OnBackInvokedDispatcher registered in onCreate.
    // This legacy override is retained exclusively for Android 8 through 12L.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed(){if(Build.VERSION.SDK_INT<33)goBack();}
    @Override protected void onPause(){CookieManager.getInstance().flush();web.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){if(microphone!=null)microphone.deny();if(fileCallback!=null)fileCallback.onReceiveValue(null);web.destroy();io.shutdownNow();super.onDestroy();}
}
