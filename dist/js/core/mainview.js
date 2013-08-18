/**
 * act as controller of controller
 * act as router delegate
 */
define(['backbone'], function(Backbone) {

  return Backbone.View.extend({
    el: 'body',
    currentView: null,

    changePage: function(newView, module) {
      if (module && !newView.module) newView.module = module;

      //inject self to the new view
      newView.container = this;

      var pageEl = newView.render().el;

      if (this.currentView) this.currentView.remove();
      document.body.appendChild(pageEl);
      this.currentView = newView;

      if ('onShow' in newView) newView.onShow();
    }
  });
});