var _ = require('underscore');
var $ = require('jquery');
var React = require('react/addons');
var Router = require('react-router');
var exec = require('exec');
var path =  require('path');
var assign =  require('object-assign');
var remote = require('remote');
var rimraf = require('rimraf');
var fs = require('fs');
var dialog = remote.require('dialog');
var ContainerStore = require('./ContainerStore');
var ContainerUtil = require('./ContainerUtil');
var docker = require('./Docker');
var boot2docker = require('./Boot2Docker');
var ProgressBar = require('react-bootstrap/ProgressBar');
var Popover = require('react-bootstrap/Popover');

var ContainerDetails = React.createClass({
  mixins: [Router.State, Router.Navigation],
  _oldHeight: 0,
  PAGE_LOGS: 'logs',
  PAGE_SETTINGS: 'settings',
  getInitialState: function () {
    return {
      logs: [],
      page: this.PAGE_LOGS,
      env: {},
      pendingEnv: {},
      ports: {},
      defaultPort: null,
      popoverVolumeOpen: false,
      popoverViewOpen: false,
    };
  },
  componentWillReceiveProps: function () {
    this.init();
  },
  componentDidMount: function () {
    this.init();
    ContainerStore.on(ContainerStore.SERVER_PROGRESS_EVENT, this.updateProgress);
    ContainerStore.on(ContainerStore.SERVER_LOGS_EVENT, this.updateLogs);

    // Make clicking anywhere close popovers
    $('body').on('click', function (e) {
      var popoverViewIsTarget = $('.popover-view').is(e.target) || $('.popover-view').has(e.target).length !== 0 || $('.dropdown-view').is(e.target) || $('.dropdown-view').has(e.target).length !== 0;
      var popoverVolumeIsTarget = $('.popover-volume').is(e.target) || $('.popover-volume').has(e.target).length !== 0 || $('.dropdown-volume').is(e.target) || $('.dropdown-volume').has(e.target).length !== 0;
      var state = {};
      if (!popoverViewIsTarget) {
        state.popoverViewOpen = false;
      }
      if (!popoverVolumeIsTarget) {
        state.popoverVolumeOpen = false;
      }
      if (this.state.popoverViewOpen || this.state.popoverVolumeOpen) {
        this.setState(state);
      }
    }.bind(this));
  },
  componentWillUnmount: function () {
    ContainerStore.removeListener(ContainerStore.SERVER_PROGRESS_EVENT, this.updateProgress);
    ContainerStore.removeListener(ContainerStore.SERVER_LOGS_EVENT, this.updateLogs);
  },
  componentDidUpdate: function () {
    // Scroll logs to bottom
    var parent = $('.details-logs');
    if (parent.length) {
      if (parent.scrollTop() >= this._oldHeight) {
        parent.stop();
        parent.scrollTop(parent[0].scrollHeight - parent.height());
      }
      this._oldHeight = parent[0].scrollHeight - parent.height();
    }

    var $viewDropdown = $(this.getDOMNode()).find('.dropdown-view > .icon-dropdown');
    var $volumeDropdown = $(this.getDOMNode()).find('.dropdown-volume');
    var $viewPopover = $(this.getDOMNode()).find('.popover-view');
    var $volumePopover = $(this.getDOMNode()).find('.popover-volume');

    if ($viewDropdown.offset()) {
      $viewPopover.offset({
        top: $viewDropdown.offset().top + 27,
        left: $viewDropdown.offset().left - ($viewPopover.outerWidth() / 2) + 5
      });
    }
    if ($volumeDropdown.offset()) {
      $volumePopover.offset({
        top: $volumeDropdown.offset().top + 33,
        left: $volumeDropdown.offset().left + $volumeDropdown.outerWidth() - $volumePopover.outerWidth() / 2 - 20
      });
    }
  },
  init: function () {
    var container = ContainerStore.container(this.getParams().name);
    if (!container) {
      return;
    }
    this.setState({
      progress: ContainerStore.progress(this.getParams().name),
      env: ContainerUtil.env(container),
      page: this.PAGE_LOGS
    });
    var ports = ContainerUtil.ports(container);
    var webPorts = ['80', '8000', '8080', '3000', '5000', '2368'];
    this.setState({
      ports: ports,
      defaultPort: _.find(_.keys(ports), function (port) {
        return webPorts.indexOf(port) !== -1;
      })
    });
    this.updateLogs();
  },
  updateLogs: function (name) {
    if (name && name !== this.getParams().name) {
      return;
    }
    this.setState({
      logs: ContainerStore.logs(this.getParams().name)
    });
  },
  updateProgress: function (name) {
    if (name === this.getParams().name) {
      this.setState({
        progress: ContainerStore.progress(name)
      });
    }
  },
  showLogs: function () {
    this.setState({
      page: this.PAGE_LOGS
    });
  },
  showSettings: function () {
    this.setState({
      page: this.PAGE_SETTINGS
    });
  },
  handleView: function () {
    if (this.state.defaultPort) {
      exec(['open', this.state.ports[this.state.defaultPort].url], function (err) {
        if (err) { throw err; }
      });
    }
  },
  handleViewLink: function (url) {
    exec(['open', url], function (err) {
      if (err) { throw err; }
    });
  },
  handleChangeDefaultPort: function (port) {
    this.setState({
      defaultPort: port
    });
  },
  handleViewDropdown: function(e) {
    this.setState({
      popoverViewOpen: !this.state.popoverViewOpen
    });
  },
  handleVolumeDropdown: function(e) {
    var self = this;
    if (_.keys(this.props.container.Volumes).length) {
      exec(['open', path.join(process.env.HOME, 'Kitematic', self.props.container.Name)], function (err) {
        if (err) { throw err; }
      });
    }
  },
  handleChooseVolumeClick: function (dockerVol) {
    var self = this;
    dialog.showOpenDialog({properties: ['openDirectory', 'createDirectory']}, function (filenames) {
      if (!filenames) {
        return;
      }
      var directory = filenames[0];
      if (directory) {
        var volumes = _.clone(self.props.container.Volumes);
        volumes[dockerVol] = directory;
        var binds = _.pairs(volumes).map(function (pair) {
          return pair[1] + ':' + pair[0];
        });
        ContainerStore.updateContainer(self.props.container.Name, {
          Binds: binds
        }, function (err) {
          if (err) console.log(err);
        });
      }
    });
  },
  handleOpenVolumeClick: function (path) {
    exec(['open', path], function (err) {
      if (err) { throw err; }
    });
  },
  handleRestart: function () {
    ContainerStore.restart(this.props.container.Name, function (err) {
      console.log(err);
    });
  },
  handleTerminal: function () {
    var container = this.props.container;
    var terminal = path.join(process.cwd(), 'resources', 'terminal');
    var cmd = [terminal, boot2docker.command().replace(/ /g, '\\\\\\\\ ').replace(/\(/g, '\\\\\\\\(').replace(/\)/g, '\\\\\\\\)'), 'ssh', '-t', 'sudo', 'docker', 'exec', '-i', '-t', container.Name, 'sh'];
    exec(cmd, function (stderr, stdout, code) {
      console.log(stderr);
      console.log(stdout);
      if (code) {
        console.log(stderr);
      }
    });
  },
  handleSaveContainerName: function () {
    if (newName === this.props.container.Name) {
      return;
    }
    var newName = $('#input-container-name').val();
    if (fs.existsSync(path.join(process.env.HOME, 'Kitematic', this.props.container.Name))) {
      fs.renameSync(path.join(process.env.HOME, 'Kitematic', this.props.container.Name), path.join(process.env.HOME, 'Kitematic', newName));
    }
    ContainerStore.updateContainer(this.props.container.Name, {
      name: newName
    }, function (err) {
      this.transitionTo('container', {name: newName});
      if (err) {
        console.error(err);
      }
    }.bind(this));
  },
  handleSaveEnvVar: function () {
    var $rows = $('.env-vars .keyval-row');
    var envVarList = [];
    $rows.each(function () {
      var key = $(this).find('.key').val();
      var val = $(this).find('.val').val();
      if (!key.length || !val.length) {
        return;
      }
      envVarList.push(key + '=' + val);
    });
    var self = this;
    ContainerStore.updateContainer(self.props.container.Name, {
      Env: envVarList
    }, function (err) {
      if (err) {
        console.error(err);
      } else {
        self.setState({
          pendingEnv: {}
        });
        $('#new-env-key').val('');
        $('#new-env-val').val('');
      }
    });
  },
  handleAddPendingEnvVar: function () {
    var newKey = $('#new-env-key').val();
    var newVal = $('#new-env-val').val();
    var newEnv = {};
    newEnv[newKey] = newVal;
    this.setState({
      pendingEnv: _.extend(this.state.pendingEnv, newEnv)
    });
    $('#new-env-key').val('');
    $('#new-env-val').val('');
  },
  handleRemoveEnvVar: function (key) {
    var newEnv = _.omit(this.state.env, key);
    this.setState({
      env: newEnv
    });
  },
  handleRemovePendingEnvVar: function (key) {
    var newEnv = _.omit(this.state.pendingEnv, key);
    this.setState({
      pendingEnv: newEnv
    });
  },
  handleDeleteContainer: function () {
    dialog.showMessageBox({
      message: 'Are you sure you want to delete this container?',
      buttons: ['Delete', 'Cancel']
    }, function (index) {
      var volumePath = path.join(process.env.HOME, 'Kitematic', this.props.container.Name);
      if (fs.existsSync(volumePath)) {
        rimraf(volumePath, function (err) {
          console.log(err);
        });
      }
      if (index === 0) {
        ContainerStore.remove(this.props.container.Name, function (err) {
          console.error(err);
        });
      }
    }.bind(this));
  },
  render: function () {
    var self = this;

    if (!this.state) {
      return <div></div>;
    }

    var logs = this.state.logs.map(function (l, i) {
      return <p key={i} dangerouslySetInnerHTML={{__html: l}}></p>;
    });

    if (!this.props.container) {
      return false;
    }

    var state;
    if (this.props.container.State.Running) {
      state = <h2 className="status running">running</h2>;
    } else if (this.props.container.State.Restarting) {
      state = <h2 className="status restarting">restarting</h2>;
    } else if (this.props.container.State.Paused) {
      state = <h2 className="status paused">paused</h2>;
    } else if (this.props.container.State.Downloading) {
      state = <h2 className="status">downloading</h2>;
    }

    var button;
    if (this.state.progress === 1) {
      button = <a className="btn btn-primary" onClick={this.handleClick}>View</a>;
    } else {
      button = <a className="btn btn-primary disabled" onClick={this.handleClick}>View</a>;
    }

    var envVars = _.map(this.state.env, function (val, key) {
      return (
        <div key={key} className="keyval-row">
          <input type="text" className="key line" defaultValue={key}></input>
          <input type="text" className="val line" defaultValue={val}></input>
          <a onClick={self.handleRemoveEnvVar.bind(self, key)} className="only-icon btn btn-action small"><span className="icon icon-cross"></span></a>
        </div>
      );
    });
    var pendingEnvVars = _.map(this.state.pendingEnv, function (val, key) {
      return (
        <div key={key} className="keyval-row">
          <input type="text" className="key line" defaultValue={key}></input>
          <input type="text" className="val line" defaultValue={val}></input>
          <a onClick={self.handleRemovePendingEnvVar.bind(self, key)} className="only-icon btn btn-action small"><span className="icon icon-arrow-undo"></span></a>
        </div>
      );
    });

    var disabledClass = '';
    if (!this.props.container.State.Running) {
      disabledClass = 'disabled';
    }

    var buttonClass = React.addons.classSet({
      btn: true,
      'btn-action': true,
      'with-icon': true,
      disabled: !this.props.container.State.Running
    });

    var restartButtonClass = React.addons.classSet({
      btn: true,
      'btn-action': true,
      'with-icon': true,
      disabled: this.props.container.State.Downloading || this.props.container.State.Restarting
    });

    var viewButtonClass = React.addons.classSet({
      btn: true,
      'btn-action': true,
      'with-icon': true,
      disabled: !this.props.container.State.Running || !this.state.defaultPort
    });

    var kitematicVolumes = _.pairs(this.props.container.Volumes).filter(function (pair) {
      return pair[1].indexOf(path.join(process.env.HOME, 'Kitematic')) !== -1;
    });

    var volumesButtonClass = React.addons.classSet({
      btn: true,
      'btn-action': true,
      'with-icon': true,
      disabled: !kitematicVolumes.length
    });

    var textButtonClasses = React.addons.classSet({
      'btn': true,
      'btn-action': true,
      'only-icon': true,
      'active': this.state.page === this.PAGE_LOGS,
      disabled: this.props.container.State.Downloading
    });

    var gearButtonClass = React.addons.classSet({
      'btn': true,
      'btn-action': true,
      'only-icon': true,
      'active': this.state.page === this.PAGE_SETTINGS,
      disabled: this.props.container.State.Downloading
    });

    var viewPopoverClasses = React.addons.classSet({
      popover: true,
      hidden: false
    });

    var popoverVolumeClasses = React.addons.classSet({
      'popover-volume': true,
      hidden: !this.state.popoverVolumeOpen
    });

    var popoverViewClasses = React.addons.classSet({
      'popover-view': true,
      hidden: !this.state.popoverViewOpen
    });

    var dropdownClasses = {
      btn: true,
      'btn-action': true,
      'with-icon': true,
      'dropdown-toggle': true,
      disabled: !this.props.container.State.Running
    };
    var dropdownViewButtonClass = React.addons.classSet(assign({'dropdown-view': true}, dropdownClasses));

    var body;
    if (this.props.container.State.Downloading) {
      if (this.state.progress) {
        body = (
          <div className="details-progress">
            <h3>Downloading</h3>
            <ProgressBar now={this.state.progress * 100} label="%(percent)s%"/>
          </div>
        );
      } else {

      }
    } else {
      if (this.state.page === this.PAGE_LOGS) {
        body = (
          <div className="details-panel details-logs">
            <div className="logs">
              {logs}
            </div>
          </div>
        );
      } else {
        var rename = (
          <div>
            <h3>Container Name</h3>
            <div className="container-name">
              <input id="input-container-name" type="text" className="line" placeholder="Container Name" defaultValue={this.props.container.Name}></input>
            </div>
            <a className="btn btn-action" onClick={this.handleSaveContainerName}>Save</a>
          </div>
        );
        body = (
          <div className="details-panel">
            <div className="settings">
              {rename}
              <h3>Environment Variables</h3>
              <div className="env-vars-labels">
                <div className="label-key">KEY</div>
                <div className="label-val">VALUE</div>
              </div>
              <div className="env-vars">
                {envVars}
                {pendingEnvVars}
                <div className="keyval-row">
                  <input id="new-env-key" type="text" className="key line"></input>
                  <input id="new-env-val" type="text" className="val line"></input>
                  <a onClick={this.handleAddPendingEnvVar} className="only-icon btn btn-positive small"><span className="icon icon-add-1"></span></a>
                </div>
              </div>
              <a className="btn btn-action" onClick={this.handleSaveEnvVar}>Save</a>
              <h3>Delete Container</h3>
              <a className="btn btn-action" onClick={this.handleDeleteContainer}>Delete Container</a>
            </div>
          </div>
        );
      }
    }

    var ports = _.map(_.pairs(self.state.ports), function (pair, index, list) {
      var key = pair[0];
      var val = pair[1];
      return (
        <div key={key} className="table-values">
          <span className="value-left">{key}</span><span className="icon icon-arrow-right"></span>
          <a className="value-right" onClick={self.handleViewLink.bind(self, val.url)}>{val.display}</a>
          <input onChange={self.handleChangeDefaultPort.bind(self, key)} type="radio" checked={self.state.defaultPort === key}/> <label>Default</label>
        </div>
      );
    });

    var volumes = _.map(self.props.container.Volumes, function (val, key) {
      if (!val || val.indexOf(process.env.HOME) === -1) {
        val = <span>No folder<a className="btn btn-primary btn-xs" onClick={self.handleChooseVolumeClick.bind(self, key)}>Choose</a></span>;
      } else {
        val = <span><a className="value-right" onClick={self.handleOpenVolumeClick.bind(self, val)}>{val.replace(process.env.HOME, '~')}</a> <a className="btn btn-primary btn-xs" onClick={self.handleChooseVolumeClick.bind(self, key)}>Choose</a></span>;
      }
      return (
        <div key={key} className="table-values">
          <span className="value-left">{key}</span><span className="icon icon-arrow-right"></span>
          {val}
        </div>
      );
    });

    var view;
    if (this.state.defaultPort) {
      view = (
        <div className="action btn-group">
          <a className={viewButtonClass} onClick={this.handleView}><span className="icon icon-preview-2"></span><span className="content">View</span></a>
          <a className={dropdownViewButtonClass} onClick={this.handleViewDropdown}><span className="icon-dropdown icon icon-arrow-37"></span></a>
        </div>
      );
    } else {
      view = (
        <div className="action">
          <a className={dropdownViewButtonClass} onClick={this.handleViewDropdown}><span className="icon icon-preview-2"></span> <span className="content">Ports</span> <span className="icon-dropdown icon icon-arrow-37"></span></a>
        </div>
      );
    }

    return (
      <div className="details">
        <div className="details-header">
          <div className="details-header-info">
            <h1>{this.props.container.Name}</h1>{state}<h2 className="image-label">Image</h2><h2 className="image">{this.props.container.Config.Image}</h2>
          </div>
          <div className="details-header-actions">
            {view}
            <div className="action">
              <a className={volumesButtonClass} onClick={this.handleVolumeDropdown}><span className="icon icon-folder-1"></span> <span className="content">Volumes</span></a>
            </div>
            <div className="action">
              <a className={restartButtonClass} onClick={this.handleRestart}><span className="icon icon-refresh"></span> <span className="content">Restart</span></a>
            </div>
            <div className="action">
              <a className={buttonClass} onClick={this.handleTerminal}><span className="icon icon-window-code-3"></span> <span className="content">Terminal</span></a>
            </div>
            <div className="details-header-actions-rhs tabs btn-group">
              <a className={textButtonClasses} onClick={this.showLogs}><span className="icon icon-text-wrapping-2"></span></a>
              <a className={gearButtonClass} onClick={this.showSettings}><span className="icon icon-setting-gear"></span></a>
            </div>
          </div>
          <Popover className={popoverViewClasses} placement="bottom">
            <div className="table ports">
              <div className="table-labels">
                <div className="label-left">DOCKER PORT</div>
                <div className="label-right">MAC PORT</div>
              </div>
              {ports}
            </div>
          </Popover>
          <Popover className={popoverVolumeClasses} placement="bottom">
            <div className="table volumes">
              <div className="table-labels">
                <div className="label-left">DOCKER VOLUME</div>
                <div className="label-right">MAC FOLDER</div>
              </div>
              {volumes}
            </div>
          </Popover>
        </div>
        {body}
      </div>
    );
  }
});

module.exports = ContainerDetails;
