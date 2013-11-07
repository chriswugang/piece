define(['text!portal/PortalView.html'], function(listViewTemplate) {

    var IndexView = Piece.View.extend({

        id: 'flightstatus-list',

        type: 'portal',

        el: ".page",

        events: {
            "click #querymore": "queryMore",
            "click #refresh": "reload",
            'click body': 'sayHello'
        },

        bindings: {
            "Segment:change io": "onIOChange",
            "List:select flightstatus-list": "onItemSelect"
        },
        sayHello: function() {
            alert("hello");
        },

        render: function() {
            // listViewTemplate = "";
            // $(this.el).html(listViewTemplate);
            Piece.View.prototype.render.call(this);
            return this;
        },

        onShow: function() {
            // alert("..");
            // $("body").click(function(){
            //     alert("=.=");
            // });
        },

        onItemSelect: function(list, data) {
            this.navigate('detailView', {
                trigger: true
            });
        },

        onGotResult: function(params) {
            alert(params);
        },

        onIOChange: function(comp) {
            var io = comp.getValue();
            console.info("=.=");
        },

        queryMore: function() {
            console.info(this.container);
            alert("navigate");
        },

        reload: function() {
            console.info(this.container);
            alert("reload");

        }
    });

    return IndexView;
});