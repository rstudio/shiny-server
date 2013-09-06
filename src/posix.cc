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

Handle<Value> GetPwUid(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    return ThrowException(Exception::Error(
          String::New("getpwuid requires 1 argument")));
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
    if (errno == 0)
      return scope.Close(Null());
    else
      return ThrowException(ErrnoException(errno, "getpwuid_r"));
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

Handle<Value> GetGroupList(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    return ThrowException(Exception::Error(
          String::New("getgrouplist requires 1 argument")));
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
    if (errno == 0)
      return scope.Close(Null());
    else
      return ThrowException(ErrnoException(errno, "getpwnam_r"));
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
      return ThrowException(Exception::Error(String::New("Unexpected error calling getgrouplist")));
#endif
    }
    else {
      Local<Array> groupList = Array::New();
      for (int j = 0; j < ngrp; j++) {
        groupList->Set(j, Integer::New(groups[j]));
      }
      return scope.Close(groupList);
    }
  }

  return ThrowException(Exception::Error(String::New("Unexpected getgrouplist behavior")));
}

Handle<Value> GetGrNam(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    return ThrowException(Exception::Error(
          String::New("getgrouplist requires 1 argument")));
  }

  String::Utf8Value name(args[0]);

  errno = 0;
  struct group * group = getgrnam(*name);
  if (!group) {
    if (errno == 0)
      return scope.Close(Null());
    else
      return ThrowException(ErrnoException(errno, "getgrnam"));
  }

  Local<Object> groupInfo = Object::New();
  groupInfo->Set(String::NewSymbol("name"), String::New(group->gr_name));
  groupInfo->Set(String::NewSymbol("passwd"), String::New(group->gr_passwd));
  groupInfo->Set(String::NewSymbol("gid"), Integer::New(group->gr_gid));
  Local<Array> members = Array::New();
  groupInfo->Set(String::NewSymbol("members"), members);
  for (int i = 0; group->gr_mem[i]; i++) {
    members->Set(members->Length(), String::New(group->gr_mem[i]));
  }

  return scope.Close(groupInfo);
}

Handle<Value> AcquireRecordLock(const Arguments& args) {
  HandleScope scope;

  // Args: fd, lockType, whence, start, len

  if (args.Length() < 5) {
    return ThrowException(Exception::Error(
          String::New("acquireRecordLock requires 5 arguments")));
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
      return scope.Close(Boolean::New(false));
    } else {
      return ThrowException(ErrnoException(errno, "acquireRecordLock"));
    }
  } else {
    return scope.Close(Boolean::New(true));
  }
}

void Initialize(Handle<Object> target) {
  target->Set(String::NewSymbol("getpwnam"),
      FunctionTemplate::New(GetPwNam)->GetFunction());
  target->Set(String::NewSymbol("getpwuid"),
      FunctionTemplate::New(GetPwUid)->GetFunction());
  target->Set(String::NewSymbol("getgrouplist"),
      FunctionTemplate::New(GetGroupList)->GetFunction());
  target->Set(String::NewSymbol("getgrnam"),
      FunctionTemplate::New(GetGrNam)->GetFunction());
  target->Set(String::NewSymbol("acquireRecordLock"),
      FunctionTemplate::New(AcquireRecordLock)->GetFunction());
}
NODE_MODULE(posix, Initialize)
