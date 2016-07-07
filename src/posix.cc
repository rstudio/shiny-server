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
#include <nan.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#include <fcntl.h>

void GetPwNam(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("getpwnam requires 1 argument");
    return;
  }

  v8::String::Utf8Value pwnam(info[0]);

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
    } else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getpwnam_r"));
      return;
    }
  }

  v8::Local<v8::Object> userInfo = Nan::New<v8::Object>();
  userInfo->Set(Nan::New("name").ToLocalChecked(),
		Nan::New(pwd.pw_name).ToLocalChecked());
  userInfo->Set(Nan::New("passwd").ToLocalChecked(),
		Nan::New(pwd.pw_passwd).ToLocalChecked());
  userInfo->Set(Nan::New("uid").ToLocalChecked(),
		Nan::New(pwd.pw_uid));
  userInfo->Set(Nan::New("gid").ToLocalChecked(),
		Nan::New(pwd.pw_gid));
  userInfo->Set(Nan::New("gecos").ToLocalChecked(),
		Nan::New(pwd.pw_gecos).ToLocalChecked());
  userInfo->Set(Nan::New("home").ToLocalChecked(),
		Nan::New(pwd.pw_dir).ToLocalChecked());
  userInfo->Set(Nan::New("shell").ToLocalChecked(),
		Nan::New(pwd.pw_shell).ToLocalChecked());

  info.GetReturnValue().Set(userInfo);
}

void GetPwUid(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    Nan::ThrowTypeError("getpwuid requires 1 argument");
    return;
  }

  uid_t pwuid = info[0]->IntegerValue();
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
      info.GetReturnValue().Set(Nan::Null());
      return;
    } else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getpwuid_r"));
      return;
    }
  }

  v8::Local<v8::Object> userInfo = Nan::New<v8::Object>();
  userInfo->Set(Nan::New("name").ToLocalChecked(),
		Nan::New(pwd.pw_name).ToLocalChecked());
  userInfo->Set(Nan::New("passwd").ToLocalChecked(),
		Nan::New(pwd.pw_passwd).ToLocalChecked());
  userInfo->Set(Nan::New("uid").ToLocalChecked(), Nan::New(pwd.pw_uid));
  userInfo->Set(Nan::New("gid").ToLocalChecked(), Nan::New(pwd.pw_gid));
  userInfo->Set(Nan::New("gecos").ToLocalChecked(),
		Nan::New(pwd.pw_gecos).ToLocalChecked());
  userInfo->Set(Nan::New("home").ToLocalChecked(),
		Nan::New(pwd.pw_dir).ToLocalChecked());
  userInfo->Set(Nan::New("shell").ToLocalChecked(),
		Nan::New(pwd.pw_shell).ToLocalChecked());

  info.GetReturnValue().Set(userInfo);
}

void GetGroupList(const Nan::FunctionCallbackInfo<v8::Value>&info ) {
  if (info.Length() < 1) {
    return Nan::ThrowTypeError("getgrouplist requires 1 argument");
  }

  v8::String::Utf8Value name(info[0]);

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
    } else {
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
      Nan::ThrowTypeError("Unexpected error calling getgrouplist");
      return;
#endif
    }
    else {
      v8::Local<v8::Array> groupList = Nan::New<v8::Array>();
      for (int j = 0; j < ngrp; j++) {
        groupList->Set(j, Nan::New(groups[j]));
      }
      info.GetReturnValue().Set(groupList);
    }
  }

  Nan::ThrowTypeError("Unexpected getgrouplist behavior");
}

void GetGrNam(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if (info.Length() < 1) {
    return Nan::ThrowTypeError("getgrouplist requires 1 argument");
  }

  v8::String::Utf8Value name(info[0]);

  errno = 0;
  struct group * group = getgrnam(*name);
  if (!group) {
    if (errno == 0) {
      info.GetReturnValue().Set(Nan::Null());
      return;
    } else {
      Nan::ThrowError(Nan::ErrnoException(errno, "getgrnam"));
      return;
    }
  }

  v8::Local<v8::Object> groupInfo = Nan::New<v8::Object>();
  groupInfo->Set(Nan::New("name").ToLocalChecked(),
		 Nan::New(group->gr_name).ToLocalChecked());
  groupInfo->Set(Nan::New("passwd").ToLocalChecked(),
		 Nan::New(group->gr_passwd).ToLocalChecked());
  groupInfo->Set(Nan::New("gid").ToLocalChecked(),
		 Nan::New(group->gr_gid));
  v8::Local<v8::Array> members = Nan::New<v8::Array>();
  groupInfo->Set(Nan::New("members").ToLocalChecked(), members);
  for (int i = 0; group->gr_mem[i]; i++) {
    members->Set(members->Length(),
		 Nan::New<v8::String>(group->gr_mem[i]).ToLocalChecked());
  }
  info.GetReturnValue().Set(groupInfo);
}

void AcquireRecordLock(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  // Args: fd, lockType, whence, start, len

  if (info.Length() < 5) {
    Nan::ThrowTypeError("acquireRecordLock requires 5 arguments");
    return;
  }

  int fd = info[0]->IntegerValue();
  short lockType = info[1]->IntegerValue();
  short whence = info[2]->IntegerValue();
  off_t start = info[3]->IntegerValue();
  off_t len = info[4]->IntegerValue();

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
  }
}

void Initialize(v8::Local<v8::Object> target) {
  target->Set(Nan::New("getpwnam").ToLocalChecked(),
      Nan::New<v8::FunctionTemplate>(GetPwNam)->GetFunction());
  target->Set(Nan::New("getpwuid").ToLocalChecked(),
      Nan::New<v8::FunctionTemplate>(GetPwUid)->GetFunction());
  target->Set(Nan::New("getgrouplist").ToLocalChecked(),
      Nan::New<v8::FunctionTemplate>(GetGroupList)->GetFunction());
  target->Set(Nan::New("getgrnam").ToLocalChecked(),
      Nan::New<v8::FunctionTemplate>(GetGrNam)->GetFunction());
  target->Set(Nan::New("acquireRecordLock").ToLocalChecked(),
      Nan::New<v8::FunctionTemplate>(AcquireRecordLock)->GetFunction());
}
NODE_MODULE(posix, Initialize)
