angular.module('portainer.docker')
.controller('ContainerController', ['$q', '$scope', '$state','$transition$', '$filter', 'Commit', 'ContainerHelper', 'ContainerService', 'ImageHelper', 'NetworkService', 'Notifications', 'ModalService', 'ResourceControlService', 'RegistryService', 'ImageService', 'HttpRequestHelper',
function ($q, $scope, $state, $transition$, $filter, Commit, ContainerHelper, ContainerService, ImageHelper, NetworkService, Notifications, ModalService, ResourceControlService, RegistryService, ImageService, HttpRequestHelper) {
  $scope.activityTime = 0;
  $scope.portBindings = [];

  $scope.config = {
    Image: '',
    Registry: ''
  };

  $scope.state = {
    recreateContainerInProgress: false,
    joinNetworkInProgress: false,
    leaveNetworkInProgress: false
  };

  var update = function () {
    var nodeName = $transition$.params().nodeName;
    HttpRequestHelper.setPortainerAgentTargetHeader(nodeName);
    $scope.nodeName = nodeName;

    ContainerService.container($transition$.params().id)
    .then(function success(data) {
      var container = data;
      $scope.container = container;
      $scope.container.edit = false;
      $scope.container.newContainerName = $filter('trimcontainername')(container.Name);

      if (container.State.Running) {
        $scope.activityTime = moment.duration(moment(container.State.StartedAt).utc().diff(moment().utc())).humanize();
      } else if (container.State.Status === 'created') {
        $scope.activityTime = moment.duration(moment(container.Created).utc().diff(moment().utc())).humanize();
      } else {
        $scope.activityTime = moment.duration(moment().utc().diff(moment(container.State.FinishedAt).utc())).humanize();
      }

      $scope.portBindings = [];
      if (container.NetworkSettings.Ports) {
        angular.forEach(Object.keys(container.NetworkSettings.Ports), function(portMapping) {
          if (container.NetworkSettings.Ports[portMapping]) {
            var mapping = {};
            mapping.container = portMapping;
            mapping.host = container.NetworkSettings.Ports[portMapping][0].HostIp + ':' + container.NetworkSettings.Ports[portMapping][0].HostPort;
            $scope.portBindings.push(mapping);
          }
        });
      }
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, 'Unable to retrieve container info');
    });
  };

  function executeContainerAction(id, action, successMessage, errorMessage) {
    action(id)
    .then(function success(data) {
      Notifications.success(successMessage, id);
      update();
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, errorMessage);
    });
  }

  $scope.start = function () {
    var successMessage = 'Container successfully started';
    var errorMessage = 'Unable to start container';
    executeContainerAction($transition$.params().id, ContainerService.startContainer, successMessage, errorMessage);
  };

  $scope.stop = function () {
    var successMessage = 'Container successfully stopped';
    var errorMessage = 'Unable to stop container';
    executeContainerAction($transition$.params().id, ContainerService.stopContainer, successMessage, errorMessage);
  };

  $scope.kill = function () {
    var successMessage = 'Container successfully killed';
    var errorMessage = 'Unable to kill container';
    executeContainerAction($transition$.params().id, ContainerService.killContainer, successMessage, errorMessage);
  };

  $scope.pause = function() {
    var successMessage = 'Container successfully paused';
    var errorMessage = 'Unable to pause container';
    executeContainerAction($transition$.params().id, ContainerService.pauseContainer, successMessage, errorMessage);
  };

  $scope.unpause = function() {
    var successMessage = 'Container successfully resumed';
    var errorMessage = 'Unable to resume container';
    executeContainerAction($transition$.params().id, ContainerService.resumeContainer, successMessage, errorMessage);
  };

  $scope.restart = function () {
    var successMessage = 'Container successfully restarted';
    var errorMessage = 'Unable to restart container';
    executeContainerAction($transition$.params().id, ContainerService.restartContainer, successMessage, errorMessage);
  };

  $scope.renameContainer = function () {
    var container = $scope.container;
    ContainerService.renameContainer($transition$.params().id, container.newContainerName)
    .then(function success(data) {
      container.Name = container.newContainerName;
      Notifications.success('Container successfully renamed', container.Name);
    })
    .catch(function error(err) {
      container.newContainerName = container.Name;
      Notifications.error('Failure', err, 'Unable to rename container');
    })
    .finally(function final() {
      $scope.container.edit = false;
    });
  };

  $scope.containerLeaveNetwork = function containerLeaveNetwork(container, networkId) {
    $scope.state.leaveNetworkInProgress = true;
    NetworkService.disconnectContainer(networkId, container.Id, false)
    .then(function success(data) {
      Notifications.success('Container left network', container.Id);
      $state.reload();
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, 'Unable to disconnect container from network');
    })
    .finally(function final() {
      $scope.state.leaveNetworkInProgress = false;
    });
  };

  $scope.containerJoinNetwork = function containerJoinNetwork(container, networkId) {
    $scope.state.joinNetworkInProgress = true;
    NetworkService.connectContainer(networkId, container.Id)
    .then(function success(data) {
      Notifications.success('Container joined network', container.Id);
      $state.reload();
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, 'Unable to connect container to network');
    })
    .finally(function final() {
      $scope.state.joinNetworkInProgress = false;
    });
  };

  $scope.commit = function () {
    var image = $scope.config.Image;
    var registry = $scope.config.Registry;
    var imageConfig = ImageHelper.createImageConfigForCommit(image, registry.URL);
    Commit.commitContainer({id: $transition$.params().id, tag: imageConfig.tag, repo: imageConfig.repo}, function (d) {
      update();
      Notifications.success('Container commited', $transition$.params().id);
    }, function (e) {
      update();
      Notifications.error('Failure', e, 'Unable to commit container');
    });
  };


  $scope.confirmRemove = function () {
    var title = 'You are about to remove a container.';
    if ($scope.container.State.Running) {
      title = 'You are about to remove a running container.';
    }
    ModalService.confirmContainerDeletion(
      title,
      function (result) {
        if(!result) { return; }
        var cleanAssociatedVolumes = false;
        if (result[0]) {
          cleanAssociatedVolumes = true;
        }
        removeContainer(cleanAssociatedVolumes);
      }
    );
  };

  function removeContainer(cleanAssociatedVolumes) {
    ContainerService.remove($scope.container, cleanAssociatedVolumes)
    .then(function success() {
      Notifications.success('Container successfully removed');
      $state.go('docker.containers', {}, {reload: true});
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, 'Unable to remove container');
    });
  }

  function recreateContainer(pullImage) {
    var container = $scope.container;
    var config = ContainerHelper.configFromContainer(container.Model);
    $scope.state.recreateContainerInProgress = true;
    ContainerService.remove(container, true)
    .then(function success() {
      return RegistryService.retrieveRegistryFromRepository(container.Config.Image);
    })
    .then(function success(data) {
      return $q.when(!pullImage || ImageService.pullImage(container.Config.Image, data, true));
    })
    .then(function success() {
      return ContainerService.createAndStartContainer(config);
    })
    .then(function success(data) {
      if (!container.ResourceControl) {
        return true;
      } else {
        var containerIdentifier = data.Id;
        var resourceControl = container.ResourceControl;
        var users = resourceControl.UserAccesses.map(function(u) {
          return u.UserId;
        });
        var teams = resourceControl.TeamAccesses.map(function(t) {
          return t.TeamId;
        });
        return ResourceControlService.createResourceControl(resourceControl.AdministratorsOnly,
          users, teams, containerIdentifier, 'container', []);
      }
    })
    .then(function success(data) {
      Notifications.success('Container successfully re-created');
      $state.go('docker.containers', {}, {reload: true});
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, 'Unable to re-create container');
      $scope.state.recreateContainerInProgress = false;
    });
  }

  $scope.recreate = function() {
    ModalService.confirmContainerRecreation(function (result) {
      if(!result) { return; }
      var pullImage = false;
      if (result[0]) {
        pullImage = true;
      }
      recreateContainer(pullImage);
    });
  };

  var provider = $scope.applicationState.endpoint.mode.provider;
  var apiVersion = $scope.applicationState.endpoint.apiVersion;
  NetworkService.networks(
    provider === 'DOCKER_STANDALONE' || provider === 'DOCKER_SWARM_MODE',
    false,
    provider === 'DOCKER_SWARM_MODE' && apiVersion >= 1.25
  )
  .then(function success(data) {
    var networks = data;
    $scope.availableNetworks = networks;
  })
  .catch(function error(err) {
    Notifications.error('Failure', err, 'Unable to retrieve networks');
  });

  update();
}]);
