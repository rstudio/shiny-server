/*
 * posix.cc
 *
 * Copyright (C) 2009-13 by RStudio, Inc.
 *
 * This program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */
#include <node.h>
#include <v8.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#include <fcntl.h>
#include <string>

using namespace node;
using namespace v8;

void GetPwNam(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "getpwnam requires 1 argument")));
    return;
  }

  String::Utf8Value pwnam(args[0]->ToString());

  int err = 0;
  struct passwd pwd;
  struct passwd *pwdp = NULL;

  int bufsize = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (bufsize == -1)  // value was indeterminant
    bufsize = 16384;
  char buf[bufsize];

  errno = 0;
  if ((err = getpwnam_r(*pwnam, &pwd, buf, bufsize, &pwdp)) || pwdp == NULL) {
    if (errno == 0) {
      args.GetReturnValue().Set(Null(isolate));
      return;
    }
    else
      isolate->ThrowException(UVException(isolate, errno, "getpwnam_r"));
      return;
  }

  Local<Object> userInfo = Object::New(isolate);
  userInfo->Set(String::NewFromUtf8(isolate, "name"), String::NewFromUtf8(isolate, pwd.pw_name));
  userInfo->Set(String::NewFromUtf8(isolate, "passwd"), String::NewFromUtf8(isolate, pwd.pw_passwd));
  userInfo->Set(String::NewFromUtf8(isolate, "uid"), Number::New(isolate, pwd.pw_uid));
  userInfo->Set(String::NewFromUtf8(isolate, "gid"), Number::New(isolate, pwd.pw_gid));
  userInfo->Set(String::NewFromUtf8(isolate, "gecos"), String::NewFromUtf8(isolate, pwd.pw_gecos));
  userInfo->Set(String::NewFromUtf8(isolate, "home"), String::NewFromUtf8(isolate, pwd.pw_dir));
  userInfo->Set(String::NewFromUtf8(isolate, "shell"), String::NewFromUtf8(isolate, pwd.pw_shell));

  args.GetReturnValue().Set(userInfo);
}

void GetPwUid(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "getpwuid requires 1 argument")));
    return;
  }

  uid_t pwuid = args[0]->IntegerValue();
  printf("%d", pwuid);

  int err = 0;
  struct passwd pwd;
  struct passwd *pwdp = NULL;

  int bufsize = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (bufsize == -1)  // value was indeterminant
    bufsize = 16384;
  char buf[bufsize];

  errno = 0;
  if ((err = getpwuid_r(pwuid, &pwd, buf, bufsize, &pwdp)) || pwdp == NULL) {
    if (errno == 0) {
      args.GetReturnValue().Set(Null(isolate));
      return;
    }
    else {
      isolate->ThrowException(UVException(isolate, errno, "getpwuid_r"));
      return;
    }
  }

  Local<Object> userInfo = Object::New(isolate);
  userInfo->Set(String::NewFromUtf8(isolate, "name"), String::NewFromUtf8(isolate, pwd.pw_name));
  userInfo->Set(String::NewFromUtf8(isolate, "passwd"), String::NewFromUtf8(isolate, pwd.pw_passwd));
  userInfo->Set(String::NewFromUtf8(isolate, "uid"), Number::New(isolate, pwd.pw_uid));
  userInfo->Set(String::NewFromUtf8(isolate, "gid"), Number::New(isolate, pwd.pw_gid));
  userInfo->Set(String::NewFromUtf8(isolate, "gecos"), String::NewFromUtf8(isolate, pwd.pw_gecos));
  userInfo->Set(String::NewFromUtf8(isolate, "home"), String::NewFromUtf8(isolate, pwd.pw_dir));
  userInfo->Set(String::NewFromUtf8(isolate, "shell"), String::NewFromUtf8(isolate, pwd.pw_shell));

  args.GetReturnValue().Set(userInfo);
  return;
}

void GetGroupList(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "getgrouplist requires 1 argument")));
    return;
  }

  String::Utf8Value name(args[0]);

  int err = 0;
  struct passwd pwd;
  struct passwd *pwdp = NULL;

  int bufsize = sysconf(_SC_GETPW_R_SIZE_MAX);
  if (bufsize == -1)  // value was indeterminant
    bufsize = 16384;
  char buf[bufsize];

#ifdef __linux__
  typedef gid_t result_t;
#else
  typedef int result_t;
#endif

  errno = 0;
  if ((err = getpwnam_r(*name, &pwd, buf, bufsize, &pwdp)) || pwdp == NULL) {
    if (errno == 0) {
      args.GetReturnValue().Set(Null(isolate));
      return;
    }
    else {
      isolate->ThrowException(UVException(isolate, errno, "getpwnam_r"));
      return;
    }
  }

  int ngrp = 64;
  gid_t gid = pwd.pw_gid;

  for (int i = 0; i < 3; i++) {

    result_t groups[ngrp];

    errno = 0;
    err = getgrouplist(*name, gid, groups, &ngrp);
    if (err == -1) {
      // Not enough buffer space; ngrp has the necessary number
      continue;
#ifndef __linux__
    } else if (err != 0) {
      // On BSD, return value is 0 on success
      isolate->ThrowException(Exception::Error(String::NewFromUtf8(isolate, "Unexpected error calling getgrouplist")));
      return;
#endif
    }
    else {
      Local<Array> groupList = Array::New(isolate);
      for (int j = 0; j < ngrp; j++) {
        groupList->Set(j, Integer::New(isolate, groups[j]));
      }
      args.GetReturnValue().Set(groupList);
      return;
    }
  }

  isolate->ThrowException(Exception::Error(String::NewFromUtf8(isolate, "Unexpected getgrouplist behavior")));
  return;
}

void GetGrNam(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "getgrouplist requires 1 argument")));
    return;
  }

  String::Utf8Value name(args[0]);

  errno = 0;
  struct group * group = getgrnam(*name);
  if (!group) {
    if (errno == 0) {
      args.GetReturnValue().Set(Null(isolate));
      return;
    }
    else {
      isolate->ThrowException(UVException(isolate, errno, "getgrnam"));
      return;
    }
  }

  Local<Object> groupInfo = Object::New(isolate);
  groupInfo->Set(String::NewFromUtf8(isolate, "name"), String::NewFromUtf8(isolate, group->gr_name));
  groupInfo->Set(String::NewFromUtf8(isolate, "passwd"), String::NewFromUtf8(isolate, group->gr_passwd));
  groupInfo->Set(String::NewFromUtf8(isolate, "gid"), Integer::New(isolate, group->gr_gid));
  Local<Array> members = Array::New(isolate);
  groupInfo->Set(String::NewFromUtf8(isolate, "members"), members);
  for (int i = 0; group->gr_mem[i]; i++) {
    members->Set(members->Length(), String::NewFromUtf8(isolate, group->gr_mem[i]));
  }

  args.GetReturnValue().Set(groupInfo);
  return;
}

void AcquireRecordLock(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  // Args: fd, lockType, whence, start, len

  if (args.Length() < 5) {
    isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "acquireRecordLock requires 5 arguments")));
    return;
  }

  int fd = args[0]->IntegerValue();
  short lockType = args[1]->IntegerValue();
  short whence = args[2]->IntegerValue();
  off_t start = args[3]->IntegerValue();
  off_t len = args[4]->IntegerValue();

  struct flock flk;
  flk.l_type = lockType;
  flk.l_whence = whence;
  flk.l_start = start;
  flk.l_len = len;

  if (-1 == fcntl(fd, F_SETLK, &flk)) {
    if (errno == EACCES || errno == EAGAIN) {
      args.GetReturnValue().Set(Boolean::New(isolate, false));
      return;
    } else {
      isolate->ThrowException(UVException(isolate, errno, "acquireRecordLock"));
      return;
    }
  } else {
    args.GetReturnValue().Set(Boolean::New(isolate, true));
    return;
  }
}

void Initialize(Handle<Object> exports) {
  NODE_SET_METHOD(exports, "getpwnam", GetPwNam);
  NODE_SET_METHOD(exports, "getpwuid", GetPwUid);
  NODE_SET_METHOD(exports, "getgrouplist", GetGroupList);
  NODE_SET_METHOD(exports, "getgrnam", GetGrNam);
  NODE_SET_METHOD(exports, "acquireRecordLock", AcquireRecordLock);
}
NODE_MODULE(posix, Initialize)
