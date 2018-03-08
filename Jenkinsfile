#!groovy

properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(artifactDaysToKeepStr: '',
                              artifactNumToKeepStr: '',
                              daysToKeepStr: '',
                              numToKeepStr: '100')),
    parameters([string(name: 'SLACK_CHANNEL', defaultValue: '#shiny-server', description: 'Slack channel to publish build message.')])
])

def prepareWorkspace(){ // accessory to clean workspace and checkout
  step([$class: 'WsCleanup'])
  checkout scm
  sh 'git reset --hard && git clean -ffdx' // lifted from rstudio/connect
}

def getBucketFromJobName(job) {
  def bucket = 'rstudio-shiny-server-os-build'
  if (job.contains('shiny-server-pro')) {
    bucket = 'rstudio-shiny-server-pro-build'
  }
  return bucket
}

def getPathFromBranch(branch_name) {
  def path = ''
  if (branch_name != 'master') {
    path = "branches/${branch_name.replaceAll('/','-')}"
  }
  return path
}

def getPackageTypeFromOs(os) {
  def type = ''
  if (os.contains('ubuntu')) {
    type = 'deb'
  } else {
    type = 'rpm'
  }
  return type
}

def s3_upload(os, arch) {
  def bucket = getBucketFromJobName(env.JOB_NAME)
  def path = getPathFromBranch(env.BRANCH_NAME)
  def type = getPackageTypeFromOs(os)
  if (path.empty) {
    // If the path is empty, we're on master and don't want 'master' to appear
    // in the object paths.
    sh "aws s3 cp packaging/build/*.${type} s3://${bucket}/${os}/${arch}/"
    sh "aws s3 cp packaging/build/VERSION s3://${bucket}/${os}/${arch}/"
  } else {
    // If the path is non-empty, we're on a branch other than master, and its
    // name should be included in the object paths.
    sh "aws s3 cp packaging/build/*.${type} s3://${bucket}/${path}/${os}/${arch}/"
    sh "aws s3 cp packaging/build/VERSION s3://${bucket}/${path}/${os}/${arch}/"
  }
}

try {
    timestamps {
        def containers = [
          [os: 'ubuntu-12.04', arch: 'x86_64'],
          [os: 'centos6.3', arch: 'x86_64']
        ]
        def parallel_containers = [:]
        for (int i = 0; i < containers.size(); i++) {
            def index = i
            parallel_containers["${containers[i].os}-${containers[i].arch}"] = {
                def current_container = containers[index]
                node('docker') {
                    stage('prepare ws/container'){
                      prepareWorkspace()
                      def image_tag = "${current_container.os}-${current_container.arch}"
                      container = pullBuildPush(image_name: 'jenkins/shiny-server', dockerfile: "docker/jenkins/Dockerfile.${current_container.os}", image_tag: image_tag, build_arg_jenkins_uid: 'JENKINS_UID', build_arg_jenkins_gid: 'JENKINS_GID')
                    }
                    container.inside() {
                        withEnv(["OS=${current_container.os}", "ARCH=${current_container.arch}"]) {
                          stage('make package'){
                              sh """
                              if [ -f ./packaging/make-package-jenkins.sh ]; then
                                ./packaging/make-package-jenkins.sh
                                else
                                ./packaging/make-package.sh
                              fi
                              """
                          }
                          stage('run tests') {
                              sh './bin/node ./node_modules/mocha/bin/mocha test'
                          }
                        }
                    }
                    stage('check licenses') {
                        sh 'tools/preflight.sh'
                    }
                    stage('s3 upload') {
                        s3_upload(current_container.os, current_container.arch)
                    }
                }
            }
        }
        parallel parallel_containers

        if (env.BRANCH_NAME == 'master') {
          sendNotifications slack_channel: SLACK_CHANNEL
        }
    }

} catch(err) {
   sendNotifications slack_channel: SLACK_CHANNEL, result: 'FAILURE'
   error("failed: ${err}")
}
