#include <node.h>
#include <v8.h>
#include <stdlib.h>
#include <unistd.h>
#include <assert.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>

using namespace node;
using namespace v8;

void GetGroups(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  gid_t *groupList;
  int ngroups = 0, i = 0;

  ngroups = sysconf(_SC_NGROUPS_MAX);

  groupList = (gid_t *)calloc(ngroups, sizeof(gid_t));
  assert(groupList != NULL);

  ngroups = getgroups(ngroups, groupList);
  assert(ngroups != -1);

  Local<Array> groupsArray = Array::New(isolate, ngroups);

  for (i = 0; i < ngroups; i++) {
    groupsArray->Set(i, Integer::New(isolate, groupList[i]));
  }

  args.GetReturnValue().Set(groupsArray);
  return;
}

void InitGroups(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "initgroups requires 1 argument")));
    return;
  }

  int err = 0, bufsize = 0;
  gid_t gid = 0;
  String::Utf8Value pwnam(args[0]);
  struct passwd pwd, *pwdp = NULL;
  bufsize = sysconf(_SC_GETPW_R_SIZE_MAX);
  char buffer[bufsize];

  errno = 0;
  if ((err = getpwnam_r(*pwnam, &pwd, buffer, bufsize, &pwdp)) ||
      pwdp == NULL) {
    if (errno == 0) {
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate, "initgroups user does not exist")));
      return;
    }
    else {
      isolate->ThrowException(UVException(isolate, errno, "getpwnam_r"));
      return;
    }
  }

  gid = pwd.pw_gid;
  if (args.Length() > 1 && args[1]->IsTrue()) {
    if ((err = setgid(gid)) == -1) {
      isolate->ThrowException(UVException(isolate, errno, "setgid"));
      return;
    }
  }

  if ((err = initgroups(*pwnam, gid)) == -1) {
    isolate->ThrowException(UVException(isolate, errno, "initgroups"));
    return;
  }

  args.GetReturnValue().Set(Undefined(isolate));
  return;
}

void Initialize(Handle<Object> exports) {
  NODE_SET_METHOD(exports, "initgroups", InitGroups);
  NODE_SET_METHOD(exports, "getgroups", GetGroups);
}

NODE_MODULE(unixgroups, Initialize);
