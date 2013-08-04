define(["text!examples/login.html"], function(LoginHtml) {
	var login = Backbone.View.extend({
		render: function() {
			$(this.el).html(LoginHtml);
			return this;
		}
	});
	return login;
});