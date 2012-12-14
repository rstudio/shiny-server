#include <node.h>
#include <v8.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>

using namespace node;
using namespace v8;

Handle<Value> GetPwNam(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    return ThrowException(Exception::Error(
          String::New("getpwnam requires 1 argument")));
  }

  String::Utf8Value pwnam(args[0]);

  int err = 0;
  struct passwd pwd;
  struct passwd *pwdp = NULL;

  int bufsize = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (bufsize == -1)  // value was indeterminant
    bufsize = 16384;
  char buf[bufsize];

  errno = 0;
  if ((err = getpwnam_r(*pwnam, &pwd, buf, bufsize, &pwdp)) || pwdp == NULL) {
    if (errno == 0)
      return scope.Close(Null());
    else
      return ThrowException(ErrnoException(errno, "getpwnam_r"));
  }

  Local<Object> userInfo = Object::New();
  userInfo->Set(String::NewSymbol("name"), String::New(pwd.pw_name));
  userInfo->Set(String::NewSymbol("passwd"), String::New(pwd.pw_passwd));
  userInfo->Set(String::NewSymbol("uid"), Number::New(pwd.pw_uid));
  userInfo->Set(String::NewSymbol("gid"), Number::New(pwd.pw_gid));
  userInfo->Set(String::NewSymbol("gecos"), String::New(pwd.pw_gecos));
  userInfo->Set(String::NewSymbol("home"), String::New(pwd.pw_dir));
  userInfo->Set(String::NewSymbol("shell"), String::New(pwd.pw_shell));

  return scope.Close(userInfo);
}

void Initialize(Handle<Object> target) {
  target->Set(String::NewSymbol("getpwnam"),
      FunctionTemplate::New(GetPwNam)->GetFunction());
}
NODE_MODULE(posix, Initialize)
