#include <node.h>
#include <stdlib.h>
#include <unistd.h>
#include <assert.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>

using namespace node;
using namespace v8;

static Handle<Value> GetGroups(const Arguments& args) {
  HandleScope scope;
  gid_t *groupList;
  int ngroups = 0, i = 0;

  ngroups = sysconf(_SC_NGROUPS_MAX);

  groupList = (gid_t *)calloc(ngroups, sizeof(gid_t));
  assert(groupList != NULL);

  ngroups = getgroups(ngroups, groupList);
  assert(ngroups != -1);

  Local<Array> groupsArray = Array::New(ngroups);

  for (i = 0; i < ngroups; i++) {
    groupsArray->Set(i, Integer::New(groupList[i]));
  }

  return scope.Close(groupsArray);
}

static Handle<Value> InitGroups(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    return ThrowException(Exception::Error(
          String::New("initgroups requires 1 argument")));
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
    if (errno == 0)
      return ThrowException(Exception::Error(
        String::New("initgroups user does not exist")));
    else
      return ThrowException(ErrnoException(errno, "getpwnam_r"));
  }

  gid = pwd.pw_gid;
  if (args.Length() > 1 && args[1]->IsTrue()) {
    if ((err = setgid(gid)) == -1)
      return ThrowException(ErrnoException(errno, "setgid"));
  }

  if ((err = initgroups(*pwnam, gid)) == -1)
    return ThrowException(ErrnoException(errno, "initgroups"));

  return Undefined();
}

extern "C" void init (Handle<Object> target) {
  target->Set(String::NewSymbol("initgroups"), FunctionTemplate::New(InitGroups)->GetFunction());
  target->Set(String::NewSymbol("getgroups"), FunctionTemplate::New(GetGroups)->GetFunction());
}

NODE_MODULE(unixgroups, init);
