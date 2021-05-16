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

// See https://github.com/nodejs/nan/issues/807#issuecomment-581536991
#if defined(__GNUC__) && __GNUC__ >= 8
#define DISABLE_WCAST_FUNCTION_TYPE _Pragma("GCC diagnostic push") _Pragma("GCC diagnostic ignored \"-Wcast-function-type\"")
#define DISABLE_WCAST_FUNCTION_TYPE_END _Pragma("GCC diagnostic pop")
#else
#define DISABLE_WCAST_FUNCTION_TYPE
#define DISABLE_WCAST_FUNCTION_TYPE_END
#endif

DISABLE_WCAST_FUNCTION_TYPE
#include <nan.h>
DISABLE_WCAST_FUNCTION_TYPE_END
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#include <fcntl.h>
#include <string>

using namespace node;
//using namespace v8;

namespace {
  // Helper methods for setting object properties

  void ObjSet(v8::Local<v8::Object> obj, const char * name, const char * value) {
    Nan::Set(obj,
      Nan::New<v8::String>(name).ToLocalChecked(),
      Nan::New<v8::String>(value).ToLocalChecked()
    ).Check();
  }

  void ObjSet(v8::Local<v8::Object> obj, const char * name, v8::Local<v8::Number> value) {
    Nan::Set(obj,
      Nan::New<v8::String>(name).ToLocalChecked(),
      value
    ).Check();
  }
}


void GetPwNam(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("getpwnam requires 1 argument");
    return;
  }

  Nan::Utf8String pwnam(Nan::To<v8::String>(info[0]).ToLocalChecked());

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
      info.GetReturnValue().Set(Nan::Null());
      return;
    }
    else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getpwnam_r"));
      return;
    }
  }

  v8::Local<v8::Object> userInfo = Nan::New<v8::Object>();
  ObjSet(userInfo, "name", pwd.pw_name);
  ObjSet(userInfo, "passwd", pwd.pw_passwd);
  ObjSet(userInfo, "uid", Nan::New<v8::Number>(pwd.pw_uid));
  ObjSet(userInfo, "gid", Nan::New<v8::Number>(pwd.pw_gid));
  ObjSet(userInfo, "gecos", pwd.pw_gecos);
  ObjSet(userInfo, "home", pwd.pw_dir);
  ObjSet(userInfo, "shell", pwd.pw_shell);

  info.GetReturnValue().Set(userInfo);
}

void GetPwUid(const Nan::FunctionCallbackInfo<v8::Value>& info) {

  if (info.Length() < 1) {
    Nan::ThrowTypeError("getpwuid requires 1 argument");
    return;
  }

  uid_t pwuid = Nan::To<v8::Integer>(info[0]).ToLocalChecked()->Value();

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
      info.GetReturnValue().Set(Nan::Null());
      return;
    }
    else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getpwuid_r"));
      return;
    }
  }

  v8::Local<v8::Object> userInfo = Nan::New<v8::Object>();
  ObjSet(userInfo, "name", pwd.pw_name);
  ObjSet(userInfo, "passwd", pwd.pw_passwd);
  ObjSet(userInfo, "uid", Nan::New<v8::Number>(pwd.pw_uid));
  ObjSet(userInfo, "gid", Nan::New<v8::Number>(pwd.pw_gid));
  ObjSet(userInfo, "gecos", pwd.pw_gecos);
  ObjSet(userInfo, "home", pwd.pw_dir);
  ObjSet(userInfo, "shell", pwd.pw_shell);

  info.GetReturnValue().Set(userInfo);
  return;
}

void GetGroupList(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("getgrouplist requires 1 argument");
    return;
  }

  Nan::Utf8String name(Nan::To<v8::String>(info[0]).ToLocalChecked());

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
      info.GetReturnValue().Set(Nan::Null());
      return;
    }
    else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getpwnam_r"));
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
      Nan::ThrowError("Unexpected error calling getgrouplist");
      return;
#endif
    }
    else {
      v8::Local<v8::Array> groupList = Nan::New<v8::Array>();
      for (int j = 0; j < ngrp; j++) {
        Nan::Set(groupList, j, Nan::New<v8::Integer>(groups[j]));
      }
      info.GetReturnValue().Set(groupList);
      return;
    }
  }

  Nan::ThrowError("Unexpected getgrouplist behavior");
  return;
}

void GetGrNam(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("getgrouplist requires 1 argument");
    return;
  }

  Nan::Utf8String name(Nan::To<v8::String>(info[0]).ToLocalChecked());

  errno = 0;
  struct group * group = getgrnam(*name);
  if (!group) {
    if (errno == 0) {
      info.GetReturnValue().Set(Nan::Null());
      return;
    }
    else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getgrnam"));
      return;
    }
  }

  v8::Local<v8::Object> groupInfo = Nan::New<v8::Object>();
  ObjSet(groupInfo, "name", group->gr_name);
  ObjSet(groupInfo, "passwd", group->gr_passwd);
  ObjSet(groupInfo, "gid", Nan::New<v8::Integer>(group->gr_gid));
  v8::Local<v8::Array> members = Nan::New<v8::Array>();
  for (int i = 0; group->gr_mem[i]; i++) {
    members->Set(Nan::GetCurrentContext(), members->Length(),
      Nan::New<v8::String>(group->gr_mem[i]).ToLocalChecked()).Check();
  }
  groupInfo->Set(Nan::GetCurrentContext(),
    Nan::New<v8::String>("members").ToLocalChecked(),
    members).Check();

  info.GetReturnValue().Set(groupInfo);
  return;
}

void AcquireRecordLock(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  // Args: fd, lockType, whence, start, len

  if (info.Length() < 5) {
    Nan::ThrowTypeError("acquireRecordLock requires 5 arguments");
    return;
  }

  v8::Local<v8::Context> ctx = Nan::GetCurrentContext();
  int fd         = info[0]->IntegerValue(ctx).ToChecked();
  short lockType = info[1]->IntegerValue(ctx).ToChecked();
  short whence   = info[2]->IntegerValue(ctx).ToChecked();
  off_t start    = info[3]->IntegerValue(ctx).ToChecked();
  off_t len      = info[4]->IntegerValue(ctx).ToChecked();

  struct flock flk;
  flk.l_type = lockType;
  flk.l_whence = whence;
  flk.l_start = start;
  flk.l_len = len;

  if (-1 == fcntl(fd, F_SETLK, &flk)) {
    if (errno == EACCES || errno == EAGAIN) {
      info.GetReturnValue().Set(Nan::False());
      return;
    } else {
      Nan::ThrowError(Nan::ErrnoException(errno, "acquireRecordLock"));
      return;
    }
  } else {
    info.GetReturnValue().Set(Nan::True());
    return;
  }
}

NAN_MODULE_INIT(Initialize) {
  Nan::Export(target, "getpwnam", GetPwNam);
  Nan::Export(target, "getpwuid", GetPwUid);
  Nan::Export(target, "getgrouplist", GetGroupList);
  Nan::Export(target, "getgrnam", GetGrNam);
  Nan::Export(target, "acquireRecordLock", AcquireRecordLock);
}
DISABLE_WCAST_FUNCTION_TYPE
NODE_MODULE(posix, Initialize)
DISABLE_WCAST_FUNCTION_TYPE_END
